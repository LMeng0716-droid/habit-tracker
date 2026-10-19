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
select habit_mobile.record_progress_v3('10000000-0000-0000-0000-000000000001','duration',(clock_timestamp() at time zone 'Asia/Shanghai')::date,'add',45);
select habit_mobile.record_progress_v3('10000000-0000-0000-0000-000000000001','duration',(clock_timestamp() at time zone 'Asia/Shanghai')::date,'add',45);
select pg_temp.assert((select actual_value=45 and revision=1 from habit_mobile.habit_daily_progress where habit_id='duration'),'retry increments exactly once');
select pg_temp.reject($q$select habit_mobile.record_progress_v3('10000000-0000-0000-0000-000000000001','duration',(clock_timestamp() at time zone 'Asia/Shanghai')::date,'add',46)$q$,'operation_id_reused');
select habit_mobile.record_progress_v3('10000000-0000-0000-0000-000000000002','duration',(clock_timestamp() at time zone 'Asia/Shanghai')::date,'add',105);
select pg_temp.assert((select actual_value=150 and revision=2 from habit_mobile.habit_daily_progress where habit_id='duration'),'actual above target retained');
select habit_mobile.record_progress_v3('10000000-0000-0000-0000-000000000003','duration',(clock_timestamp() at time zone 'Asia/Shanghai')::date,'set',20,2);
select pg_temp.reject($q$select habit_mobile.record_progress_v3('10000000-0000-0000-0000-000000000004','duration',(clock_timestamp() at time zone 'Asia/Shanghai')::date,'set',200,2)$q$,'revision_conflict');
select pg_temp.reject($q$select habit_mobile.record_progress_v3('10000000-0000-0000-0000-000000000005','duration',(clock_timestamp() at time zone 'Asia/Shanghai')::date,'add',-1)$q$,'value_out_of_range');
select pg_temp.reject($q$select habit_mobile.record_progress_v3('10000000-0000-0000-0000-000000000006','duration',(clock_timestamp() at time zone 'Asia/Shanghai')::date,'add',9223372036854775807)$q$,'value_out_of_range');
select pg_temp.reject($q$select habit_mobile.record_progress_v3('10000000-0000-0000-0000-000000000007','legacy-new',(clock_timestamp() at time zone 'Asia/Shanghai')::date,'add',1)$q$,'boolean_checkin_required');
select pg_temp.reject($q$insert into habit_mobile.progress_operations(operation_id,habit_id,date,action,input_value,value_after,revision) values('10000000-0000-0000-0000-000000000008','duration',(clock_timestamp() at time zone 'Asia/Shanghai')::date,'add',1,999,999)$q$,'permission denied');
select pg_temp.reject($q$update habit_mobile.progress_operations set value_after=999$q$,'permission denied');
select pg_temp.reject($q$delete from habit_mobile.progress_operations$q$,'permission denied');
-- Direct allowed input insertion must run the identical command validation.
insert into habit_mobile.progress_operations(operation_id,habit_id,date,action,input_value)
values('10000000-0000-0000-0000-000000000009','count',(clock_timestamp() at time zone 'Asia/Shanghai')::date,'add',30);
select pg_temp.assert((select actual_value=30 and revision=1 from habit_mobile.habit_daily_progress where habit_id='count'),'trigger computes immutable result');
select pg_temp.reject($q$select habit_mobile.record_progress_v3('10000000-0000-0000-0000-000000000010','count',(clock_timestamp() at time zone 'Asia/Shanghai')::date+1,'add',1)$q$,'date_not_eligible');
select pg_temp.reject($q$select habit_mobile.reorder_habits_v3(array['duration','duration'],array['duration'])$q$,'invalid_order_ids');
select pg_temp.reject($q$select habit_mobile.reorder_habits_v3(array[]::text[],array_fill('x'::text,array[501]))$q$,'invalid_order_ids');
-- Exact-list CAS; reverse active set then reject a stale original list.
do $$ declare original text[]; reordered text[]; begin
 select array_agg(id order by sort_order,created_at,id) into original from habit_mobile.habits where archived_on is null;
 select array_agg(id order by n desc) into reordered from unnest(original) with ordinality t(id,n);
 perform habit_mobile.reorder_habits_v3(reordered,original);
 perform habit_mobile.reorder_habits_v3(reordered,original); -- response retry
 begin perform habit_mobile.reorder_habits_v3(original,original); raise exception 'FAIL expected conflict'; exception when serialization_failure then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select pg_temp.assert((select count(*) from habit_mobile.habit_daily_progress)=0,'B cannot read A progress view');
select pg_temp.assert((select count(*) from habit_mobile.progress_operations)=0,'B cannot read A receipts');
select pg_temp.reject($q$select habit_mobile.record_progress_v3('20000000-0000-0000-0000-000000000001','duration',(clock_timestamp() at time zone 'Asia/Shanghai')::date,'add',1)$q$,'habit_not_found');
select pg_temp.reject($q$select habit_mobile.edit_habit_v3('duration','attack',0,'🌱')$q$,'habit_not_found');
select pg_temp.reject($q$select habit_mobile.reorder_habits_v3(array['duration'],array[]::text[])$q$,'invalid_order_ids');
select pg_temp.reject($q$insert into habit_mobile.progress_operations(user_id,operation_id,habit_id,date,action,input_value) values('00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','duration',(clock_timestamp() at time zone 'Asia/Shanghai')::date,'add',1)$q$,'permission denied');
select pg_temp.assert(habit_mobile.read_summary_v3((clock_timestamp() at time zone 'Asia/Shanghai')::date,(clock_timestamp() at time zone 'Asia/Shanghai')::date)->'completion_rate'='null'::jsonb,'empty dates are null not 100 percent');
select habit_mobile.create_habit_v3('duration','B的计时',0,'📚','duration',10,'minute');
select habit_mobile.record_progress_v3('10000000-0000-0000-0000-000000000001','duration',(clock_timestamp() at time zone 'Asia/Shanghai')::date,'add',1);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select pg_temp.assert((select actual_value=20 from habit_mobile.habit_daily_progress where habit_id='duration'),'same operation ID and text habit ID isolated by account');
do $$ declare count_before bigint; begin
 select count(*) into count_before from habit_mobile.progress_operations;
 begin
  perform habit_mobile.record_progress_v3('10000000-0000-0000-0000-000000000011','count',(clock_timestamp() at time zone 'Asia/Shanghai')::date,'add',1);
  perform habit_mobile.create_habit_v3('rollback','',0);
 exception when check_violation then null;
 end;
 perform pg_temp.assert((select count(*) from habit_mobile.progress_operations)=count_before,'command/result atomic rollback');
end $$;
select habit_mobile.archive_habit_v3('duration');
select habit_mobile.record_progress_v3('10000000-0000-0000-0000-000000000003','duration',(clock_timestamp() at time zone 'Asia/Shanghai')::date,'set',20,2);
select pg_temp.reject($q$select habit_mobile.record_progress_v3('10000000-0000-0000-0000-000000000012','duration',(clock_timestamp() at time zone 'Asia/Shanghai')::date,'add',1)$q$,'habit_archived');
select pg_temp.assert((select actual_value=20 from habit_mobile.habit_daily_progress where habit_id='duration'),'archive keeps values and original receipt replay');
select pg_temp.assert(jsonb_array_length(habit_mobile.read_snapshot_v3()->'progress')=2,'bounded read includes both numeric modes');
select pg_temp.reject($q$select habit_mobile.read_snapshot_v3((clock_timestamp() at time zone 'Asia/Shanghai')::date-367,(clock_timestamp() at time zone 'Asia/Shanghai')::date)$q$,'invalid_date_range');
select pg_temp.assert(habit_mobile.read_snapshot_v3()->>'today'=((clock_timestamp() at time zone 'Asia/Shanghai')::date)::text,'business date independent of database timezone');
select habit_mobile.read_streaks_v3();
select pg_temp.assert((habit_mobile.read_summary_v3((clock_timestamp() at time zone 'Asia/Shanghai')::date,(clock_timestamp() at time zone 'Asia/Shanghai')::date,'count')->>'completion_rate')::numeric=100,'count reaching target completes');
select pg_temp.assert((habit_mobile.read_summary_v3((clock_timestamp() at time zone 'Asia/Shanghai')::date,(clock_timestamp() at time zone 'Asia/Shanghai')::date,'duration')->>'completion_rate')::numeric=0,'below-target duration not complete');
select pg_temp.assert((habit_mobile.read_summary_v3((clock_timestamp() at time zone 'Asia/Shanghai')::date,(clock_timestamp() at time zone 'Asia/Shanghai')::date,'duration')->'days'->0->>'actual_minutes')::integer=20,'minutes not mixed into checkin count');
select pg_temp.reject($q$select habit_mobile.read_summary_v3((clock_timestamp() at time zone 'Asia/Shanghai')::date-366,(clock_timestamp() at time zone 'Asia/Shanghai')::date)$q$,'invalid_date_range');

reset role;
select pg_temp.assert(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='habit_mobile' and (p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'],false) or has_function_privilege('anon',p.oid,'EXECUTE'))),'all RPCs invoker, fixed path, anon denied');
select pg_temp.assert(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='habit_mobile' and c.relkind='r' and (not c.relrowsecurity or not c.relforcerowsecurity)),'all tables FORCE RLS');
select pg_temp.assert((select reloptions @> array['security_invoker=true'] from pg_class where oid='habit_mobile.habit_daily_progress'::regclass),'view invokes caller RLS');
rollback;
\echo 'PASS V3 RLS, replay, CAS, range, rollback, legacy API, archive, order, caller-security view'
