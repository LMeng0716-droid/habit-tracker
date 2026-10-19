"""Only called with the newly created, labelled disposable Docker container."""
import concurrent.futures, json, subprocess, sys, time
container=sys.argv[1]
D=['docker','--host=unix:///var/run/docker.sock']
label=subprocess.check_output([*D,'inspect','--format','{{index .Config.Labels "habit-tracker.disposable-v3"}}',container],text=True).strip()
assert label=='true', 'Refuse unlabelled/non-local container'
PSQL=[*D,'exec','-i',container,'psql','-X','-At','-U','postgres','-v','ON_ERROR_STOP=1']
A='00000000-0000-0000-0000-000000000003'; B='00000000-0000-0000-0000-000000000004'; S='00000000-0000-0000-0000-000000000005'
TODAY="(clock_timestamp() at time zone 'Asia/Shanghai')::date"
def sql(q,check=True): return subprocess.run(PSQL,input=q,text=True,capture_output=True,check=check)
def auth(uid): return f"set role authenticated; select set_config('request.jwt.claim.sub','{uid}',false);"
def op(id,value,action='record',revision='0',event=None):
 event=event or id
 return f"select habit_mobile.record_progress_v3('{id}','{event}','n',{TODAY},'{action}',{value},({TODAY})::timestamp at time zone 'Asia/Shanghai',{revision});"
sql(f"insert into auth.users values('{A}'),('{B}'),('{S}');")
sql(auth(A)+"select habit_mobile.create_habit_v3('n','计数',0,'🏃','count',30,'repetition');")
sql(auth(B)+"select habit_mobile.create_habit_v3('n','B计数',0,'🏃','count',30,'repetition');")
sql(auth(S)+"select habit_mobile.create_habit('a','A',0);select habit_mobile.create_habit('b','B',0);select habit_mobile.create_habit('c','C',0);")
def contend(owner,first,second,success=True,independent=False):
 p=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 try:
  p.stdin.write('begin;'+auth(owner)+first+"select 'LOCK_HELD';\n"); p.stdin.flush()
  for line in p.stdout:
   if line.strip()=='LOCK_HELD': break
  else: raise AssertionError(p.stderr.read())
  with concurrent.futures.ThreadPoolExecutor() as pool:
   future=pool.submit(sql,"set application_name='habit_v3_contender';"+auth(owner)+second,False)
   deadline=time.monotonic()+5
   while time.monotonic()<deadline:
    assert not future.done(), 'Second same-user writer must wait for serialization'
    waiting=sql("select count(*) from pg_stat_activity where application_name='habit_v3_contender' and wait_event_type='Lock' and wait_event='advisory';").stdout.strip()
    if waiting=='1': break
    time.sleep(.05)
   else: raise AssertionError('Contending session did not reach the actual advisory lock')
   if independent:
    other=pool.submit(sql,auth(B)+op('30000000-0000-0000-0000-000000000099',1))
    assert other.result(timeout=5).returncode==0, 'Other account must not be locked'
   p.stdin.write('commit;\n'); p.stdin.close(); p.stdin=None
   stdout,stderr=p.communicate(timeout=10); assert p.returncode==0,stderr
   result=future.result(timeout=10)
   if success: assert result.returncode==0,result.stderr
   else: assert result.returncode!=0 and ('revision_conflict' in result.stderr or 'order_conflict' in result.stderr),result.stderr
 finally:
  if p.poll() is None: p.terminate(); p.wait(timeout=5)
contend(A,op('30000000-0000-0000-0000-000000000001',3),op('30000000-0000-0000-0000-000000000002',7),independent=True)
assert sql(auth(A)+"select actual_value from habit_mobile.habit_daily_progress where habit_id='n';").stdout.splitlines()[-1]=='10'
contend(A,op('30000000-0000-0000-0000-000000000003',1),op('30000000-0000-0000-0000-000000000003',1))
assert sql(auth(A)+"select actual_value,event_count from habit_mobile.habit_daily_progress where habit_id='n';").stdout.splitlines()[-1]=='11|3'
event='30000000-0000-0000-0000-000000000001'
contend(A,op('30000000-0000-0000-0000-000000000004',20,'revise','1',event),op('30000000-0000-0000-0000-000000000005',30,'revise','1',event),success=False)
assert sql(auth(A)+"select actual_value,event_count from habit_mobile.habit_daily_progress where habit_id='n';").stdout.splitlines()[-1]=='28|3'
# Retrying the same void operation in two sessions subtracts only the selected event once.
contend(A,op('30000000-0000-0000-0000-000000000006',20,'void','2',event),op('30000000-0000-0000-0000-000000000006',20,'void','2',event))
assert sql(auth(A)+"select actual_value,event_count from habit_mobile.habit_daily_progress where habit_id='n';").stdout.splitlines()[-1]=='8|2'
contend(S,"select habit_mobile.reorder_habits_v3(array['c','b','a'],array['a','b','c']);","select habit_mobile.reorder_habits_v3(array['b','a','c'],array['a','b','c']);",success=False)
assert sql(auth(S)+"select string_agg(id,',' order by sort_order,created_at,id) from habit_mobile.habits;").stdout.splitlines()[-1]=='c,b,a'
print('PASS concurrent increments, duplicate operation, event correction CAS, duplicate void, reorder CAS, independent account locks')
