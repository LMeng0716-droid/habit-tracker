-- Isolated LOCAL PostgreSQL fixture ONLY; not a production/real Auth user seed.
-- Requires the foundation migration and local-bootstrap.sql stubs.
-- All fixtures and temporary write grants are rolled back. ON_ERROR_STOP required.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into habit_api.user_profiles(user_id) select id from auth.users;
insert into habit_api.categories(user_id,id,name) select id,'shared','分类' from auth.users;
insert into habit_api.categories(user_id,id,name) values ('00000000-0000-0000-0000-000000000002','b-only','B私有');
insert into habit_api.habits(user_id,id,name,color,category_id,created_date,legacy_created_at_ms) select id,'shared','习惯',0,'shared','2026-10-01',1 from auth.users;
insert into habit_api.schedule_versions(user_id,id,habit_id,effective_date,kind) select id,'plan','shared','2026-10-01','daily' from auth.users;
insert into habit_api.completions(user_id,habit_id,date) select id,'shared','2026-10-09' from auth.users;
insert into habit_api.daily_notes(user_id,id,habit_id,date,body) select id,'note',null,'2026-10-09','每日总结' from auth.users;
insert into habit_api.habit_orders(user_id,ordered_habit_ids) select id,array['shared'] from auth.users;
insert into habit_api.import_batches(user_id,id,source_sha256,source_schema,status) select id,id,repeat('a',64),2,'committed' from auth.users;

-- Constraint tests run as administrator so failures demonstrate integrity,
-- not merely privilege denial. Only these fixtures exist in the local DB.
do $$
begin
  begin
    insert into habit_api.daily_notes values ('00000000-0000-0000-0000-000000000001','duplicate',null,'2026-10-09','x',1,now(),now(),null);
    raise exception 'FAIL duplicate NULL-habit summary accepted';
  exception when unique_violation then null; end;
  begin
    insert into habit_api.schedule_versions(user_id,id,habit_id,effective_date,kind) values ('00000000-0000-0000-0000-000000000001','bad','shared','2026-10-12','weeklyQuota');
    raise exception 'FAIL quota with NULL target accepted';
  exception when check_violation then null; end;
  begin
    insert into habit_api.habits(user_id,id,name,color,category_id,created_date,legacy_created_at_ms) values ('00000000-0000-0000-0000-000000000001','bad','x',0,'b-only','2026-10-01',1);
    raise exception 'FAIL cross-user category reference accepted';
  exception when foreign_key_violation then null; end;
end $$;

set local role anon;
do $$ begin
  begin perform * from habit_api.habits; raise exception 'FAIL anon read';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
do $$
declare t text; total bigint; foreign_rows bigint;
begin
  foreach t in array array['user_profiles','categories','habits','schedule_versions','completions','daily_notes','habit_orders','import_batches'] loop
    execute format('select count(*),count(*) filter(where user_id <> auth.uid()) from habit_api.%I',t) into total,foreign_rows;
    if total <> 1 or foreign_rows <> 0 then raise exception 'FAIL A isolation: %',t; end if;
  end loop;
  begin insert into habit_api.categories(user_id,id,name) values (auth.uid(),'new','x'); raise exception 'FAIL ungranted direct write';
  exception when insufficient_privilege then null; end;
  begin perform * from habit_private.change_events; raise exception 'FAIL private read';
  exception when insufficient_privilege then null; end;
  begin delete from habit_api.habits; raise exception 'FAIL physical delete';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
do $$ declare t text; total bigint; foreign_rows bigint;
begin
  foreach t in array array['user_profiles','categories','habits','schedule_versions','completions','daily_notes','habit_orders','import_batches'] loop
    execute format('select count(*),count(*) filter(where user_id <> auth.uid()) from habit_api.%I',t) into total,foreign_rows;
    if total < 1 or foreign_rows <> 0 then raise exception 'FAIL B isolation: %',t; end if;
  end loop;
end $$;
select set_config('request.jwt.claim.sub','',true);
do $$ begin if exists(select 1 from habit_api.habits) then raise exception 'FAIL null uid visible'; end if; end $$;
reset role;

-- Temporarily grant mutation rights INSIDE this rolled-back test transaction
-- to exercise policies independently of the production privilege gate.
grant insert,update on all tables in schema habit_api to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
do $$ declare t text; affected bigint;
begin
  foreach t in array array['user_profiles','categories','habits','schedule_versions','completions','daily_notes','habit_orders','import_batches'] loop
    execute format('update habit_api.%I set version=version+1 where user_id= %L::uuid',t,'00000000-0000-0000-0000-000000000002');
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'FAIL cross-user UPDATE: %',t; end if;
    begin
      execute format('update habit_api.%I set user_id= %L::uuid where user_id=auth.uid()',t,'00000000-0000-0000-0000-000000000002');
      raise exception 'FAIL owner reassignment: %',t;
    exception when insufficient_privilege then null; end;
  end loop;
  begin insert into habit_api.categories(user_id,id,name) values ('00000000-0000-0000-0000-000000000002','forged','x'); raise exception 'FAIL forged INSERT';
  exception when insufficient_privilege then null; end;
  update habit_api.categories set name='A合法更新' where id='shared';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL own UPDATE control'; end if;
end $$;
reset role;
rollback;
\echo 'PASS foundation constraints, owner SELECT/UPDATE/INSERT policies and privilege gates; fixtures/grants rolled back'
do $$ declare n integer; t text;
begin
  select count(*) into n from pg_class c join pg_namespace s on s.oid=c.relnamespace
   where s.nspname in ('habit_api','habit_private') and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity;
  if n <> 11 then raise exception 'FAIL not all 11 tables ENABLE/FORCE RLS'; end if;
  foreach t in array array['user_profiles','categories','habits','schedule_versions','completions','daily_notes','habit_orders','import_batches'] loop
    if has_table_privilege('authenticated','habit_api.'||t,'INSERT') or has_table_privilege('authenticated','habit_api.'||t,'UPDATE') or has_table_privilege('authenticated','habit_api.'||t,'DELETE') then
      raise exception 'FAIL temporary write grants escaped rollback: %',t;
    end if;
  end loop;
end $$;
\echo 'PASS final RLS flags and read-only production grant boundary'
