-- LOCAL disposable fixtures only. Mock request.jwt.claim.sub is NOT JWT verification.
\set ON_ERROR_STOP on
begin;
set local time zone 'America/Los_Angeles';
insert into auth.users values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002') on conflict do nothing;
create function pg_temp.assert(p boolean,msg text) returns void language plpgsql as $$ begin if p is not true then raise exception 'FAIL: %',msg; end if; end $$;
create function pg_temp.reject(sql text,expected text) returns void language plpgsql as $$ begin
  begin execute sql; exception when others then if sqlerrm like '%'||expected||'%' then return; end if; raise; end;
  raise exception 'FAIL expected rejection: %',expected;
end $$;
set local role anon;
select pg_temp.reject('select habit_mobile.read_snapshot_v3()','permission denied');
select pg_temp.reject('select * from habit_mobile.habit_daily_progress','permission denied');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.reject('select habit_mobile.read_snapshot_v3()','authentication_required');
select pg_temp.reject($q$select habit_mobile.create_habit_v3('unauth','x',0)$q$,'authentication_required');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select habit_mobile.create_habit('legacy-new','旧客户端创建',0);
select habit_mobile.edit_habit_v3('legacy-new','旧客户端创建',0,'📚');
select habit_mobile.create_habit('legacy-new','旧客户端创建',0);
select pg_temp.assert((select emoji='📚' from habit_mobile.habits where id='legacy-new'),'old create retry preserves new emoji');
select habit_mobile.set_checkin('legacy-new',(clock_timestamp() at time zone 'Asia/Shanghai')::date,true);
select habit_mobile.set_checkin('legacy-new',(clock_timestamp() at time zone 'Asia/Shanghai')::date,false);
select habit_mobile.edit_habit('legacy-new','旧版改名',2);
select habit_mobile.set_checkin('legacy-new',(clock_timestamp() at time zone 'Asia/Shanghai')::date,true);
select habit_mobile.archive_habit('legacy-new');
select habit_mobile.archive_habit('legacy-new');
select pg_temp.assert((select count(*) from habit_mobile.habit_checkins where habit_id='legacy-new')=1,'old archive preserves old Boolean completion');
select habit_mobile.create_habit_v3('duration','学习',0,'📚','duration',120,'minute');
select habit_mobile.create_habit_v3('count','俯卧撑',1,'🏃','count',30,'repetition');
select pg_temp.reject($q$select habit_mobile.create_habit_v3('bad-emoji','x',0,'<script>')$q$,'check constraint');
select pg_temp.reject($q$select habit_mobile.create_habit_v3('bad-unit','x',0,'🌱','duration',120,'kilogram')$q$,'check constraint');
select pg_temp.reject($q$update habit_mobile.habits set target=99 where id='duration'$q$,'permission denied');
select pg_temp.reject($q$select habit_mobile.set_checkin('duration',(clock_timestamp() at time zone 'Asia/Shanghai')::date,true)$q$,'v3_numeric_required');
select pg_temp.reject($q$select habit_mobile.edit_habit('duration','wrong',0)$q$,'v3_client_required');
select pg_temp.assert(not exists(select 1 from jsonb_array_elements(habit_mobile.read_snapshot()->'habits') h where h->>'id' in ('duration','count')),'old client hides numeric modes');

-- Stable operation+event UUIDs and exact timestamps make retries reproducible.
create function pg_temp.event(op integer,ev integer,h text,v integer,act text default 'record',rev bigint default 0,days_ago integer default 0,kind text default 'occurrence') returns jsonb language sql as $$
 select habit_mobile.record_progress_v3(md5('op'||op)::uuid,md5('event'||ev)::uuid,h,
 (statement_timestamp() at time zone 'Asia/Shanghai')::date-days_ago,act,v,
 ((statement_timestamp() at time zone 'Asia/Shanghai')::date-days_ago)::timestamp at time zone 'Asia/Shanghai',rev,kind)
$$;
select pg_temp.event(1,1,'duration',45);
select pg_temp.event(1,1,'duration',45);
select pg_temp.assert((select actual_value=45 and event_count=1 from habit_mobile.habit_daily_progress where habit_id='duration'),'retry exactly once');
select pg_temp.reject($q$select pg_temp.event(1,1,'duration',46)$q$,'operation_id_reused');
select pg_temp.event(2,2,'duration',105);
select pg_temp.assert((select actual_value=150 and event_count=2 from habit_mobile.habit_daily_progress where habit_id='duration'),'independent events sum');
select pg_temp.event(3,1,'duration',20,'revise',1);
select pg_temp.assert((select actual_value=125 from habit_mobile.habit_daily_progress where habit_id='duration'),'correct one event only');
select pg_temp.reject($q$select pg_temp.event(4,1,'duration',10,'revise',1)$q$,'event_revision_conflict');
select pg_temp.reject($q$select pg_temp.event(51,2,'duration',1,'void',1)$q$,'void_payload_mismatch');
select pg_temp.event(5,2,'duration',105,'void',1);
select pg_temp.assert((select actual_value=20 and event_count=1 from habit_mobile.habit_daily_progress where habit_id='duration'),'void one event');
select pg_temp.event(5,2,'duration',105,'void',1);
select pg_temp.assert((select count(*)=4 from habit_mobile.progress_operations where habit_id='duration'),'all revisions retained, void retry not duplicated');
select pg_temp.reject($q$select pg_temp.event(6,2,'duration',1,'revise',2)$q$,'event_revision_conflict');
select pg_temp.reject($q$select pg_temp.event(7,3,'duration',-1)$q$,'value_out_of_range');
select pg_temp.reject($q$select pg_temp.event(8,3,'duration',2147483648::integer)$q$,'out of range');
select pg_temp.reject($q$select pg_temp.event(9,3,'duration',1441)$q$,'value_out_of_range');
select pg_temp.reject($q$select pg_temp.event(10,3,'legacy-new',1)$q$,'boolean_checkin_required');
select pg_temp.reject($q$select pg_temp.event(11,3,'duration',1,'record',0,-1)$q$,'date_not_eligible');
select pg_temp.reject($q$update habit_mobile.progress_operations set input_value=999$q$,'permission denied');
select pg_temp.reject($q$delete from habit_mobile.progress_operations$q$,'permission denied');
select pg_temp.reject($q$update habit_mobile.progress_operations set revision=999$q$,'permission denied');
select pg_temp.reject($q$insert into habit_mobile.progress_operations(operation_id,event_id,event_kind,habit_id,date,action,input_value,occurred_at,expected_revision,revision) values(md5('forge')::uuid,md5('forge')::uuid,'occurrence','duration',current_date,'record',1,clock_timestamp(),0,999)$q$,'permission denied');
select habit_mobile.create_habit_v3('snacks','零食',0,'🍎','count',2,'repetition','at_most');
select habit_mobile.create_habit_v3('coffee','咖啡记录',0,'🌱','count',null,'repetition','tracking_only');
select habit_mobile.create_habit_v3('zero','零次目标',0,'🌱','count',0,'repetition','at_most');
select pg_temp.reject($q$select habit_mobile.create_habit_v3('bad-target','x',0,'🌱','count',null,'repetition','at_least')$q$,'check constraint');
select pg_temp.reject($q$select habit_mobile.create_habit_v3('bad-tracking','x',0,'🌱','count',2,'repetition','tracking_only')$q$,'check constraint');
select pg_temp.event(20,20,'snacks',1);
select pg_temp.event(21,21,'snacks',1);
select pg_temp.assert((select status='within_limit_pending' from habit_mobile.habit_goal_days where habit_id='snacks'),'at_most not completed before midnight');
select pg_temp.event(22,22,'snacks',1);
select pg_temp.assert((select status='exceeded' from habit_mobile.habit_goal_days where habit_id='snacks'),'third snack exceeds limit');
select pg_temp.event(23,22,'snacks',1,'void',1);
select pg_temp.assert((select status='within_limit_pending' from habit_mobile.habit_goal_days where habit_id='snacks'),'undo returns pending, not celebration');
select pg_temp.reject($q$select pg_temp.event(24,24,'snacks',0,'record',0,0,'day_confirmation')$q$,'closed_day_confirmation_required');
select pg_temp.event(25,25,'coffee',1);
select pg_temp.assert((select status='recorded' from habit_mobile.habit_goal_days where habit_id='coffee'),'tracking no pass/fail');
select pg_temp.assert(habit_mobile.read_summary_v3((clock_timestamp() at time zone 'Asia/Shanghai')::date,(clock_timestamp() at time zone 'Asia/Shanghai')::date,'coffee')->'completion_rate'='null'::jsonb,'tracking denominator empty');
select pg_temp.assert(not exists(select 1 from jsonb_array_elements(habit_mobile.read_streaks_v3()) h where h->>'id'='coffee' and ((h->>'longest')::integer<>0 or h->'badges'<>'[]'::jsonb)),'tracking no streak or badges');

select pg_temp.assert(jsonb_array_length(habit_mobile.read_events_v3('duration',(clock_timestamp() at time zone 'Asia/Shanghai')::date))=2,'latest event detail includes void state, not revisions');
select pg_temp.assert(jsonb_array_length(habit_mobile.read_events_v3('duration',(clock_timestamp() at time zone 'Asia/Shanghai')::date,null,0,true))=4,'audit contains all four immutable revisions');
do $$ declare one jsonb; two jsonb; begin
 one:=habit_mobile.read_events_v3('duration',(clock_timestamp() at time zone 'Asia/Shanghai')::date,null,0,false,1);
 two:=habit_mobile.read_events_v3('duration',(clock_timestamp() at time zone 'Asia/Shanghai')::date,(one->0->>'event_id')::uuid,(one->0->>'revision')::bigint,false,1);
 perform pg_temp.assert(jsonb_array_length(two)=1 and one->0->>'event_id'<>two->0->>'event_id','keyset pages distinct events');
end $$;
select pg_temp.reject($q$select habit_mobile.read_events_v3('duration',current_date,null,0,false,101)$q$,'invalid_detail_page');
select pg_temp.reject($q$select pg_temp.event(26,26,'duration',1440)$q$,'daily_value_out_of_range');

-- Direct input insertion cannot bypass trigger rules or forge another owner.
insert into habit_mobile.progress_operations(operation_id,event_id,event_kind,habit_id,date,action,input_value,occurred_at,expected_revision)
 values(md5('raw')::uuid,md5('raw')::uuid,'occurrence','coffee',(clock_timestamp() at time zone 'Asia/Shanghai')::date,'record',1,clock_timestamp(),0);
select pg_temp.assert((select actual_value=2 from habit_mobile.habit_daily_progress where habit_id='coffee'),'direct allowed columns validated and aggregated');
select pg_temp.reject($q$insert into habit_mobile.progress_operations(user_id,operation_id,event_id,event_kind,habit_id,date,action,input_value,occurred_at,expected_revision) values('00000000-0000-0000-0000-000000000002',md5('foreign')::uuid,md5('foreign')::uuid,'occurrence','coffee',current_date,'record',1,clock_timestamp(),0)$q$,'permission denied');
select pg_temp.reject($q$select habit_mobile.record_events_v3('[]'::jsonb)$q$,'invalid_event_batch');
select pg_temp.reject($q$select pg_temp.event(27,27,'snacks',1000001)$q$,'value_out_of_range');
select pg_temp.assert(('2024-12-31T16:00:00Z'::timestamptz at time zone 'Asia/Shanghai')::date='2025-01-01'::date and ('2024-02-28T16:00:00Z'::timestamptz at time zone 'Asia/Shanghai')::date='2024-02-29'::date,'Beijing cross-year and leap-day boundaries');
-- Atomic batch rollback: first event cannot survive second invalid event.
do $$ declare n bigint; d text:=((clock_timestamp() at time zone 'Asia/Shanghai')::date)::text; ts text:=clock_timestamp()::text; begin
 select count(*) into n from habit_mobile.progress_operations;
 begin
 perform habit_mobile.record_events_v3(jsonb_build_array(
 jsonb_build_object('operation_id',md5('batch1')::uuid,'event_id',md5('batch1')::uuid,'habit_id','coffee','date',d,'action','record','value',1,'occurred_at',ts),
 jsonb_build_object('operation_id',md5('batch2')::uuid,'event_id',md5('batch2')::uuid,'habit_id','coffee','date',d,'action','record','value',-1,'occurred_at',ts)));
 raise exception 'FAIL expected rollback';
 exception when others then if sqlerrm not like '%value_out_of_range%' then raise; end if; end;
 perform pg_temp.assert((select count(*) from habit_mobile.progress_operations)=n,'whole batch rollback');
end $$;
select pg_temp.reject($q$select habit_mobile.reorder_habits_v3(array['duration','duration'],array['duration'])$q$,'invalid_order_ids');
do $$ declare a text[]; b text[]; begin
 select array_agg(id order by sort_order,created_at,id) into a from habit_mobile.habits where archived_on is null;
 select array_agg(id order by n desc) into b from unnest(a) with ordinality t(id,n);
 perform habit_mobile.reorder_habits_v3(b,a); perform habit_mobile.reorder_habits_v3(b,a);
 begin perform habit_mobile.reorder_habits_v3(a,a); raise exception 'FAIL expected conflict'; exception when serialization_failure then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select pg_temp.reject($q$select habit_mobile.read_events_v3('duration',current_date)$q$,'habit_not_found');
select pg_temp.assert((select count(*) from habit_mobile.progress_operations)=0,'B cannot read receipts');
select pg_temp.assert((select count(*) from habit_mobile.habit_events)=0,'B cannot read event history');
select pg_temp.assert((select count(*) from habit_mobile.habit_goal_days)=0,'B cannot read aggregate');
select pg_temp.reject($q$select pg_temp.event(30,1,'duration',1)$q$,'habit_not_found');
select pg_temp.reject($q$select habit_mobile.edit_habit_v3('duration','attack',0,'🌱')$q$,'habit_not_found');
select pg_temp.reject($q$select habit_mobile.reorder_habits_v3(array['duration'],array[]::text[])$q$,'invalid_order_ids');
select habit_mobile.create_habit_v3('duration','B计数',0,'🌱','count',30,'repetition');
select pg_temp.event(1,1,'duration',1);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select pg_temp.assert((select actual_value=20 from habit_mobile.habit_daily_progress where habit_id='duration'),'same event+operation IDs isolated by user');

-- Historical fixture setup ONLY in the newly-created disposable database.
reset role;
alter table habit_mobile.habits disable trigger guard_habit;
insert into habit_mobile.habits(user_id,id,name,color,created_date,habit_type,goal_direction,target,unit)
values('00000000-0000-0000-0000-000000000001','past-limit','历史限制',0,(clock_timestamp() at time zone 'Asia/Shanghai')::date-40,'count','at_most',2,'repetition');
alter table habit_mobile.habits enable trigger guard_habit;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select pg_temp.assert(habit_mobile.read_summary_v3((clock_timestamp() at time zone 'Asia/Shanghai')::date-1,(clock_timestamp() at time zone 'Asia/Shanghai')::date-1,'past-limit')->'completion_rate'='null'::jsonb,'unrecorded past day unknown, not automatic success');
select pg_temp.event(40,40,'past-limit',0,'record',0,1,'day_confirmation');
select pg_temp.assert((select actual_value=0 and status='completed' from habit_mobile.habit_goal_days where habit_id='past-limit'),'explicit zero confirmed after day closes');
select pg_temp.event(41,41,'past-limit',1,'record',0,1);
select pg_temp.assert((select status='unknown' from habit_mobile.habit_goal_days where habit_id='past-limit'),'late event invalidates completeness confirmation');
select pg_temp.event(42,40,'past-limit',0,'revise',1,1,'day_confirmation');
select pg_temp.assert((select status='completed' from habit_mobile.habit_goal_days where habit_id='past-limit'),'reconfirmation after correction');
select pg_temp.event(43,43,'past-limit',2,'record',0,1);
select pg_temp.assert((select status='exceeded' from habit_mobile.habit_goal_days where habit_id='past-limit'),'closed day exceeds regardless confirmation');
select pg_temp.event(44,43,'past-limit',2,'void',1,1);
select pg_temp.assert((select status='unknown' from habit_mobile.habit_goal_days where habit_id='past-limit'),'undo invalidates confirmation too');
select pg_temp.event(45,40,'past-limit',0,'revise',2,1,'day_confirmation');
-- Explicitly confirm 30 closed days, including zero occurrence days.
do $$ begin for n in 2..30 loop perform pg_temp.event(100+n,100+n,'past-limit',0,'record',0,n,'day_confirmation'); end loop; end $$;
select pg_temp.assert(exists(select 1 from jsonb_array_elements(habit_mobile.read_streaks_v3()) h where h->>'id'='past-limit' and (h->>'longest')::integer=30 and jsonb_array_length(h->'badges')=3),'at_most closed-day 7/21/30 badges');
-- A voided confirmation removes that day's success and splits the derived streak.
select pg_temp.event(200,115,'past-limit',0,'void',1,15,'day_confirmation');
select pg_temp.assert(exists(select 1 from jsonb_array_elements(habit_mobile.read_streaks_v3()) h where h->>'id'='past-limit' and (h->>'longest')::integer=15 and jsonb_array_length(h->'badges')=1),'history correction can revoke derived badges');
select pg_temp.event(201,115,'past-limit',0,'revise',2,15,'day_confirmation');
select pg_temp.assert(exists(select 1 from jsonb_array_elements(habit_mobile.read_streaks_v3()) h where h->>'id'='past-limit' and (h->>'longest')::integer=30),'withdrawn confirmation can be explicitly reconfirmed using its original ID');
select habit_mobile.archive_habit_v3('past-limit');
select pg_temp.event(300,300,'past-limit',1,'record',0,1);
select pg_temp.assert((select status='unknown' from habit_mobile.habit_goal_days where habit_id='past-limit' and date=(clock_timestamp() at time zone 'Asia/Shanghai')::date-1),'archived numeric history can be corrected, invalidates confirmation');
select pg_temp.reject($q$select pg_temp.event(301,301,'past-limit',1,'record',0,-1)$q$,'habit_archived');
select pg_temp.reject($q$select habit_mobile.record_progress_v3(md5('wrong-day')::uuid,md5('wrong-day')::uuid,'past-limit',(clock_timestamp() at time zone 'Asia/Shanghai')::date,'record',1,(((clock_timestamp() at time zone 'Asia/Shanghai')::date-1)::timestamp + interval '15 hours 59 minutes 59 seconds') at time zone 'UTC')$q$,'date_not_eligible');
select pg_temp.assert(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='habit_mobile' and has_function_privilege('anon',p.oid,'EXECUTE')),'anonymous has no RPC execution');
select pg_temp.assert(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='habit_mobile' and p.prosecdef),'no definer');
select pg_temp.assert(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='habit_mobile' and c.relkind='r' and (not c.relrowsecurity or not c.relforcerowsecurity)),'FORCE RLS all tables');
rollback;
select 'PASS V3 event revisions, retry/CAS/undo, directions, batch atomicity, RLS, legacy API and reorder';
