#!/usr/bin/env python3
"""Disposable LOCAL Docker only. Accepts no database URL or remote endpoint."""
import os, secrets, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
MODE = sys.argv[1] if len(sys.argv) == 2 else 'upgrade'
if MODE not in ('empty', 'upgrade'): raise SystemExit('Expected empty or upgrade')
IMAGE = 'postgres:17@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3'
DOCKER = ['docker', '--host=unix:///var/run/docker.sock']
ENV = {k: v for k, v in os.environ.items() if k not in ('DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH')}
def docker(*args, **kwargs): return subprocess.run([*DOCKER,*args],env=kwargs.pop("env",ENV),check=True,**kwargs)
container = docker('run','--detach','--label','habit-tracker.disposable-v3=true','--env','POSTGRES_PASSWORD',IMAGE,env={**ENV,'POSTGRES_PASSWORD':secrets.token_hex(24)},capture_output=True,text=True).stdout.strip()
def sql(text, check=True):
 return subprocess.run([*DOCKER,'exec','-i',container,'psql','-X','-At','-U','postgres','-v','ON_ERROR_STOP=1'],env=ENV,input=text,text=True,capture_output=True,check=check)
def apply(path, role='managed_migration_admin'): return sql('set role '+role+';\n'+(ROOT/path).read_text())
try:
 import time
 for i in range(30):
  if subprocess.run([*DOCKER,'exec',container,'sh','-c','[ "$(cat /proc/1/comm)" = postgres ] && pg_isready -U postgres'],env=ENV,capture_output=True).returncode==0: break
  time.sleep(1)
 else: raise RuntimeError('Disposable database not ready')
 print('PostgreSQL '+sql('show server_version;').stdout.strip(),flush=True)
 sql((ROOT/'supabase/tests/local-bootstrap.sql').read_text())
 sql('revoke grant option for usage on schema auth from managed_migration_admin; revoke grant option for execute on function auth.uid() from managed_migration_admin;')
 apply('supabase/migrations/202610110001_mobile_cloud.sql')
 # Baseline tests execute before the extension, preserving their original scope.
 result=sql((ROOT/'supabase/tests/mobile_cloud.sql').read_text()); print(result.stdout.splitlines()[-1])
 if MODE=='upgrade':
  sql("""insert into auth.users values('00000000-0000-0000-0000-000000000001');
  create schema habit_test_fixture;
  alter table habit_mobile.habits disable trigger guard_habit;
  insert into habit_mobile.habits(user_id,id,name,color,created_date,archived_on) values
  ('00000000-0000-0000-0000-000000000001','older-active','旧习惯',0,'2025-01-01',null),
  ('00000000-0000-0000-0000-000000000001','older-archived','旧归档',1,'2024-02-01','2024-03-10');
  alter table habit_mobile.habits enable trigger guard_habit;
  alter table habit_mobile.habit_checkins disable trigger guard_checkin;
  insert into habit_mobile.habit_checkins(user_id,habit_id,date) select '00000000-0000-0000-0000-000000000001','older-archived',d::date from generate_series('2024-02-01'::date,'2024-03-10'::date,'1 day') d;
  alter table habit_mobile.habit_checkins enable trigger guard_checkin;
  create table habit_test_fixture.old_habits as select user_id,id,name,color,created_date,archived_on,created_at from habit_mobile.habits;
  create table habit_test_fixture.old_checkins as table habit_mobile.habit_checkins;
  """)
 sql((ROOT/'supabase/checks/v3-review.sql').read_text())
 old_integrity=sql((ROOT/'supabase/checks/v3-data-integrity.sql').read_text()).stdout.splitlines()[:3]
 proposal=(ROOT/'supabase/proposals/202610190001_v3_expansion.sql').read_text()
 failed=sql('set role managed_migration_admin;\n'+proposal.replace("notify pgrst,'reload schema';","select 1/0;"),check=False)
 assert failed.returncode!=0 and 'division by zero' in failed.stderr, 'Must reach the injected late failure: '+failed.stderr
 assert sql("select to_regclass('habit_mobile.progress_operations') is null;").stdout.strip() == 't'
 assert sql("select count(*) from information_schema.columns where table_schema='habit_mobile' and table_name='habits' and column_name='emoji';").stdout.strip() == '0'
 apply('supabase/proposals/202610190001_v3_expansion.sql')
 sql((ROOT/'supabase/checks/v3-review.sql').read_text())
 assert sql((ROOT/'supabase/checks/v3-data-integrity.sql').read_text()).stdout.splitlines()[:3]==old_integrity, 'Read-only integrity hashes must match'
 print('PASS before/after read-only catalog checks and unchanged canonical hashes')
 failed=sql('set role managed_migration_admin;\n'+proposal,check=False)
 assert failed.returncode!=0 and 'v3_already_installed_or_partial' in failed.stderr
 if MODE=='upgrade':
  result=sql("""do $$ begin if exists(select * from habit_test_fixture.old_habits except select user_id,id,name,color,created_date,archived_on,created_at from habit_mobile.habits) or exists(select * from habit_test_fixture.old_checkins except select * from habit_mobile.habit_checkins) then raise exception 'history_changed'; end if; end $$;
  set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
  select habit_mobile.read_streaks_v3();
  do $$ declare v jsonb; begin
    v:=habit_mobile.read_summary_v3('2024-01-31','2024-03-11','older-archived');
    if (v->>'due')::integer<>39 or (v->>'completed')::integer<>39 or (v->'days'->0->>'due')::integer<>0 or (v->'days'->40->>'due')::integer<>0 then raise exception 'invalid_historical_summary'; end if;
  end $$;""")
  assert '"days": 30' in result.stdout and '"achieved_on": "2024-03-01"' in result.stdout, result.stdout
  print('PASS unchanged historical columns/checkins, leap-year 30-day badge')
 result=sql((ROOT/'supabase/tests/v3_expansion.sql').read_text()); print(result.stdout.splitlines()[-1])
 subprocess.run([sys.executable,str(ROOT/'supabase/tests/v3_concurrency.py'),container],env=ENV,check=True)
 if MODE=='upgrade': subprocess.run([sys.executable,str(ROOT/'supabase/tests/v3_performance.py'),container],env=ENV,check=True)
 print('PASS PG17 '+MODE+' installation, intentional failure rollback, repeat refusal')
except subprocess.CalledProcessError as error:
 print((error.stderr or '')[-6000:],file=sys.stderr); raise
finally:
 docker('rm','--force',container,stdout=subprocess.DEVNULL)
