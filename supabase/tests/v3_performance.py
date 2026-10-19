"""Synthetic local-only volume probe. Never accepts a database URL."""
import json,subprocess,sys,time
container=sys.argv[1]; D=['docker','--host=unix:///var/run/docker.sock']
assert subprocess.check_output([*D,'inspect','--format','{{index .Config.Labels "habit-tracker.disposable-v3"}}',container],text=True).strip()=='true'
def sql(text): return subprocess.check_output([*D,'exec','-i',container,'psql','-X','-At','-U','postgres','-v','ON_ERROR_STOP=1'],input=text,text=True)
uid='00000000-0000-0000-0000-000000000006'; today="(clock_timestamp() at time zone 'Asia/Shanghai')::date"
sql(f"""insert into auth.users values('{uid}');
-- Fixture setup only: never disable RLS. Re-enable these two command triggers
-- before the measurements. Production proposal never disables any trigger.
alter table habit_mobile.habits disable trigger guard_habit;
insert into habit_mobile.habits(user_id,id,name,color,created_date,habit_type,target,unit)
select '{uid}','perf-'||n,'volume fixture',0,{today}-1824,'duration',3,'minute' from generate_series(1,10) n;
alter table habit_mobile.habits enable trigger guard_habit;
alter table habit_mobile.progress_operations disable trigger guard_progress_v3;
insert into habit_mobile.progress_operations(user_id,operation_id,habit_id,date,action,input_value,value_after,revision)
select '{uid}',md5(h.id||d::text||r::text)::uuid,h.id,{today}-d,'add',1,r,r from habit_mobile.habits h cross join generate_series(0,1824) d cross join generate_series(1,3) r where h.user_id='{uid}';
alter table habit_mobile.progress_operations enable trigger guard_progress_v3;
analyze habit_mobile.habits; analyze habit_mobile.progress_operations;
""")
auth=f"set role authenticated; select set_config('request.jwt.claim.sub','{uid}',false);"
start=time.perf_counter()
values=sql(auth+f"select octet_length(habit_mobile.read_snapshot_v3()::text),octet_length(habit_mobile.read_summary_v3({today}-364,{today})::text);").splitlines()[-1].split('|')
elapsed=round((time.perf_counter()-start)*1000,1)
assert int(values[0])>int(values[1])*2
streaks=json.loads(sql(auth+'select habit_mobile.read_streaks_v3();').splitlines()[-1])
assert len(streaks)==10 and all(h['longest']==1825 for h in streaks)
print(json.dumps({'synthetic_habits':10,'history_days':1825,'journal_rows':54750,'annual_detail_bytes':int(values[0]),'annual_summary_bytes':int(values[1]),'two_local_rpc_queries_including_docker_ms':elapsed,'five_year_streaks_verified':True}))
