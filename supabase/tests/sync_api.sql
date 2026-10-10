\set ON_ERROR_STOP on
-- Isolated local Auth stubs only; all fixtures/mutations roll back.
begin;
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
create function pg_temp.assert(p boolean,msg text) returns void language plpgsql as $$ begin if p is not true then raise exception 'FAIL: %',msg; end if; end $$;
create function pg_temp.op(n bigint,t text,v text,d jsonb) returns jsonb language sql as $$ select jsonb_build_object('operation_id','00000000-0000-0000-0000-'||lpad(n::text,12,'0'),'type',t,'expected_version',v,'data',d) $$;
create function pg_temp.send(n bigint,t text,v text,d jsonb) returns jsonb language sql as $$ select habit_api.apply_operations(jsonb_build_array(pg_temp.op(n,t,v,d))) $$;
create function pg_temp.reject(ops jsonb,msg text) returns void language plpgsql as $$
begin
  begin perform habit_api.apply_operations(ops);
  exception when others then
    if position(msg in sqlerrm)=0 then raise exception 'FAIL expected %, got %',msg,sqlerrm; end if;
    return;
  end;
  raise exception 'FAIL expected error %',msg;
end $$;

set local role anon;
do $$ begin
  begin perform habit_api.full_snapshot(); raise exception 'FAIL anon API'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  begin perform habit_api.full_snapshot(); raise exception 'FAIL empty uid'; exception when insufficient_privilege then null; end;
  begin perform habit_api.bootstrap_user('00000000-0000-0000-0000-000000000001'); raise exception 'FAIL bootstrap empty uid'; exception when insufficient_privilege then null; end;
  begin perform habit_api.apply_operations('[]'); raise exception 'FAIL write empty uid'; exception when insufficient_privilege then null; end;
  begin perform habit_api.pull_changes('0'); raise exception 'FAIL pull empty uid'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select habit_api.bootstrap_user('00000000-0000-0000-0000-000000000010','Asia/Shanghai');
select pg_temp.assert(habit_api.full_snapshot()->>'cursor'='8','bootstrap creates 8 events');
select habit_api.bootstrap_user('00000000-0000-0000-0000-000000000010','Asia/Shanghai');
select pg_temp.assert(habit_api.full_snapshot()->>'cursor'='8','bootstrap retry no duplicate');
select pg_temp.reject(jsonb_build_array(pg_temp.op(10,'bootstrap','0','{"timezone":"UTC"}')),'operation_id_reused');
select pg_temp.send(11,'category_create','0','{"id":"custom","name":"阅读"}');
select pg_temp.send(105,'category_update','1','{"id":"custom","name":"阅读计划"}');
select pg_temp.assert((select name from habit_api.categories where id='custom')='阅读计划','category rename');
select pg_temp.send(12,'habit_create','0',jsonb_build_object('id','hex-string-not-uuid','name','阅读','color',0,'category_id','custom','created_date',((now() at time zone 'Asia/Shanghai')::date-10)::text,'created_at_ms',1,'plan_id','initial:hex-string-not-uuid','schedule',jsonb_build_object('kind','daily'),'order_version','1'));
select pg_temp.assert(habit_api.full_snapshot()->'habits'->0->>'id'='hex-string-not-uuid','legacy string identity preserved');
select pg_temp.send(13,'habit_update','1','{"id":"hex-string-not-uuid","name":"阅读20分钟","color":1,"category_id":"custom"}');
select pg_temp.send(13,'habit_update','1','{"id":"hex-string-not-uuid","name":"阅读20分钟","color":1,"category_id":"custom"}');
select pg_temp.assert(habit_api.full_snapshot()->'habits'->0->>'version'='2','same op applies once');
select pg_temp.reject(jsonb_build_array(pg_temp.op(14,'habit_update','1','{"id":"hex-string-not-uuid","name":"stale","color":0,"category_id":null}')),'version_conflict');
select pg_temp.assert(habit_api.full_snapshot()->'habits'->0->>'name'='阅读20分钟','stale update did not overwrite');
select pg_temp.reject(jsonb_build_array(pg_temp.op(15,'category_create','0','{"id":"foreign","name":"bad","user_id":"00000000-0000-0000-0000-000000000002"}')),'invalid_payload');
select pg_temp.send(16,'note_set','0',jsonb_build_object('habit_id','hex-string-not-uuid','date',(now() at time zone 'Asia/Shanghai')::date::text,'body','独立备注'));
select pg_temp.assert(habit_api.full_snapshot()->'notes'->0->>'id'='["hex-string-not-uuid","'||(now() at time zone 'Asia/Shanghai')::date::text||'"]','compact legacy note ID');
select pg_temp.send(17,'completion_set','0',jsonb_build_object('habit_id','hex-string-not-uuid','date',(now() at time zone 'Asia/Shanghai')::date::text,'completed',true));
select pg_temp.send(18,'completion_set','1',jsonb_build_object('habit_id','hex-string-not-uuid','date',(now() at time zone 'Asia/Shanghai')::date::text,'completed',false));
select pg_temp.assert(habit_api.full_snapshot()->'completions'->0->>'completed'='false','undo state retained');
select pg_temp.assert(habit_api.full_snapshot()->'notes'->0->>'body'='独立备注','undo preserves note');
select pg_temp.send(19,'note_set','0',jsonb_build_object('habit_id',null,'date',(now() at time zone 'Asia/Shanghai')::date::text,'body','每日总结'));
select pg_temp.send(20,'plan_set','0','{"habit_id":"hex-string-not-uuid","id":"next-plan","schedule":{"kind":"weekdays","days":[1,3,5]}}');
select pg_temp.assert((select effective_date from habit_api.schedule_versions where id='next-plan')=(now() at time zone 'Asia/Shanghai')::date-(extract(isodow from (now() at time zone 'Asia/Shanghai')::date)::integer-1)+7,'next ISO Monday boundary');
select pg_temp.assert((select weekday_mask from habit_api.schedule_versions where id='next-plan')=21,'ISO weekday mask preserves V1.1 days');
select pg_temp.send(21,'plan_set','1','{"habit_id":"hex-string-not-uuid","id":"next-plan","schedule":{"kind":"weeklyQuota","count":3}}');
select pg_temp.assert(jsonb_array_length(habit_api.full_snapshot()->'schedules')=2,'history preserved, future plan updated');
select pg_temp.reject(jsonb_build_array(pg_temp.op(22,'plan_set','2','{"habit_id":"hex-string-not-uuid","id":"different","schedule":{"kind":"daily"}}')),'immutable_plan_id');
select pg_temp.send(23,'reorder','2','{"ids":["hex-string-not-uuid"]}');
select pg_temp.reject(jsonb_build_array(pg_temp.op(24,'reorder','2','{"ids":["hex-string-not-uuid"]}')),'version_conflict');

-- Whole-batch rollback: first operation would succeed, second is invalid.
do $$ declare snap jsonb:=habit_api.full_snapshot(); begin
  perform pg_temp.reject(jsonb_build_array(pg_temp.op(25,'category_create','0','{"id":"rollback","name":"x"}'),pg_temp.op(26,'category_create','0','{"id":"invalid","name":""}')),'check constraint');
  perform pg_temp.assert(habit_api.full_snapshot()=snap,'batch error rolls data/events/sequence back');
end $$;
select pg_temp.send(25,'category_create','0','{"id":"rollback","name":"x"}');
select pg_temp.assert(exists(select 1 from habit_api.categories where id='rollback'),'failed operation ID can retry');

-- Database exception at receipt insertion must roll back earlier business/event writes.
reset role;
create function pg_temp.fail_receipt() returns trigger language plpgsql as $$ begin
  if new.operation_id='00000000-0000-0000-0000-000000000090'::uuid then raise exception 'injected_storage_error'; end if;
  return new;
end $$;
create trigger injected_receipt_failure before insert on habit_private.operation_receipts for each row execute function pg_temp.fail_receipt();
set local role authenticated;
do $$ declare snap jsonb:=habit_api.full_snapshot(); begin
  perform pg_temp.reject(jsonb_build_array(pg_temp.op(90,'category_create','0','{"id":"failure-test","name":"x"}')),'injected_storage_error');
  perform pg_temp.assert(habit_api.full_snapshot()=snap,'receipt storage exception rolls all state back');
end $$;
reset role;
select pg_temp.assert(not exists(select 1 from habit_private.operation_receipts where operation_id='00000000-0000-0000-0000-000000000090'),'no failure receipt retained');
drop trigger injected_receipt_failure on habit_private.operation_receipts;
set local role authenticated;
select pg_temp.send(90,'category_create','0','{"id":"failure-test","name":"x"}');

-- Paging pins H while a new write occurs between pages.
do $$ declare first jsonb; second jsonb; high text; before_head text; begin
  before_head:=habit_api.full_snapshot()->>'cursor';
  first:=habit_api.pull_changes('0',null,3); high:=first->>'high_water';
  perform pg_temp.send(27,'category_create','0','{"id":"after-watermark","name":"new"}');
  second:=habit_api.pull_changes(first->>'next_cursor',high,500);
  perform pg_temp.assert((jsonb_array_length(first->'events')+jsonb_array_length(second->'events'))::bigint=high::bigint,'fixed watermark covers exactly old events');
  perform pg_temp.assert(second->>'next_cursor'=high and second->>'has_more'='false','bounded page reaches high water');
  perform pg_temp.assert(habit_api.pull_changes(high,null,500)->'events'->0->>'sequence'=(high::bigint+1)::text,'new write available next round');
  perform pg_temp.assert(habit_api.pull_changes('0',high,3)=first,'duplicate page request stable');
end $$;
-- Reject malformed schedules and timestamps; a future or unplanned day is not a failure record.
select pg_temp.reject(jsonb_build_array(pg_temp.op(91,'plan_set','2','{"habit_id":"hex-string-not-uuid","id":"next-plan","schedule":{"kind":"weekdays","days":[1,1]}}')),'invalid_schedule');
select pg_temp.reject(jsonb_build_array(pg_temp.op(92,'completion_set','0',jsonb_build_object('habit_id','hex-string-not-uuid','date',((now() at time zone 'Asia/Shanghai')::date+1)::text,'completed',true))),'future_date');
select pg_temp.reject(jsonb_build_array(pg_temp.op(93,'reorder','3','{"ids":["hex-string-not-uuid","hex-string-not-uuid"]}')),'invalid_order_membership');
select pg_temp.reject(jsonb_build_array(pg_temp.op(94,'category_delete','1','{"id":"preset-0"}')),'preset_category_is_immutable');
select pg_temp.send(28,'category_delete','2','{"id":"custom"}');
select pg_temp.assert(habit_api.full_snapshot()->'habits'->0->>'category_id' is null,'category delete detaches not deletes habit');
select pg_temp.assert(habit_api.full_snapshot()->'habits'->0->>'deleted_at' is null,'habit survives category delete');
select pg_temp.send(29,'completion_set','2',jsonb_build_object('habit_id','hex-string-not-uuid','date',(now() at time zone 'Asia/Shanghai')::date::text,'completed',true));
-- Category cascade incremented habit version from 2 to 3.
select pg_temp.send(30,'habit_archive','3','{"id":"hex-string-not-uuid"}');
select pg_temp.assert(habit_api.full_snapshot()->'completions'->0->>'completed'='false','archive cancels today');
select pg_temp.assert(jsonb_array_length(habit_api.full_snapshot()->'notes')=2,'archive preserves notes');
select pg_temp.send(31,'habit_delete','4','{"id":"hex-string-not-uuid"}');
select pg_temp.assert(habit_api.full_snapshot()->'habits'->0->>'deleted_at' is not null,'habit tombstone retained');
select pg_temp.assert(habit_api.full_snapshot()->'order'->'ordered_habit_ids'='[]'::jsonb,'delete removes from order');
select pg_temp.assert(exists(select 1 from jsonb_array_elements(habit_api.pull_changes('0',null,500)->'events') e where e->>'entity_type'='habit' and e->'payload'->>'deleted_at' is not null),'tombstone available in feed');
select pg_temp.reject(jsonb_build_array(pg_temp.op(32,'habit_update','5','{"id":"hex-string-not-uuid","name":"revive","color":0,"category_id":null}')),'entity_not_found');

-- Active V1-style hex ID with unplanned weekday remains writable for notes only.
select pg_temp.send(95,'habit_create','0',jsonb_build_object('id','0000000000000000000000000000000a','name','星期习惯','color',2,'category_id',null,'created_date',(now() at time zone 'Asia/Shanghai')::date::text,'created_at_ms',1,'plan_id','initial:0000000000000000000000000000000a','schedule',jsonb_build_object('kind','weekdays','days',jsonb_build_array((extract(isodow from (now() at time zone 'Asia/Shanghai')::date)::integer % 7)+1)),'order_version','4'));
select pg_temp.reject(jsonb_build_array(pg_temp.op(96,'completion_set','0',jsonb_build_object('habit_id','0000000000000000000000000000000a','date',(now() at time zone 'Asia/Shanghai')::date::text,'completed',true))),'unplanned_date');
select pg_temp.send(97,'note_set','0',jsonb_build_object('habit_id','0000000000000000000000000000000a','date',(now() at time zone 'Asia/Shanghai')::date::text,'body','未计划日笔记'));
select pg_temp.reject(jsonb_build_array(pg_temp.op(98,'plan_set','0','{"habit_id":"0000000000000000000000000000000a","id":"past","effective_date":"1900-01-01","schedule":{"kind":"daily"}}')),'invalid_payload');
select pg_temp.send(106,'note_set','1',jsonb_build_object('habit_id','0000000000000000000000000000000a','date',(now() at time zone 'Asia/Shanghai')::date::text,'body',''));
select pg_temp.assert(exists(select 1 from habit_api.daily_notes where habit_id='0000000000000000000000000000000a' and deleted_at is not null),'clear note emits tombstone');
select pg_temp.send(107,'note_set','2',jsonb_build_object('habit_id','0000000000000000000000000000000a','date',(now() at time zone 'Asia/Shanghai')::date::text,'body','恢复备注'));
select pg_temp.assert(exists(select 1 from habit_api.daily_notes where habit_id='0000000000000000000000000000000a' and deleted_at is null and version=3),'explicit versioned note recreation');
select pg_temp.send(99,'profile_update','1','{"timezone":"Asia/Shanghai"}');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select habit_api.bootstrap_user('00000000-0000-0000-0000-000000000010','UTC');
select pg_temp.assert(jsonb_array_length(habit_api.full_snapshot()->'habits')=0,'B snapshot cannot read A');
select pg_temp.assert(habit_api.full_snapshot()->>'cursor'='8','B sequence isolated');
select pg_temp.reject(jsonb_build_array(pg_temp.op(33,'habit_update','5','{"id":"hex-string-not-uuid","name":"attack","color":0,"category_id":null}')),'version_conflict');
select pg_temp.reject(jsonb_build_array(pg_temp.op(34,'note_set','0',jsonb_build_object('habit_id','hex-string-not-uuid','date',current_date::text,'body','attack'))),'habit_date_not_eligible');
select pg_temp.assert(not exists(select 1 from habit_api.habits),'B direct SELECT cannot read A');
select pg_temp.reject(jsonb_build_array(pg_temp.op(100,'habit_update','1','{"id":"0000000000000000000000000000000a","name":"attack active A","color":0,"category_id":null}')),'version_conflict');
select pg_temp.send(101,'habit_create','0',jsonb_build_object('id','b-only','name','B独有习惯','color',0,'category_id',null,'created_date',current_date::text,'created_at_ms',1,'plan_id','initial:b-only','schedule',jsonb_build_object('kind','daily'),'order_version','1'));
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select pg_temp.reject(jsonb_build_array(pg_temp.op(102,'habit_update','1','{"id":"b-only","name":"attack B","color":0,"category_id":null}')),'version_conflict');
select pg_temp.assert(not exists(select 1 from jsonb_array_elements(habit_api.full_snapshot()->'habits') x where x->>'id'='b-only'),'A API snapshot cannot read active B');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select pg_temp.assert(habit_api.full_snapshot()->'habits'->0->>'name'='B独有习惯','A attack did not change B');
do $$ begin
  begin update habit_api.habits set name='attack'; raise exception 'FAIL direct write'; exception when insufficient_privilege then null; end;
  begin perform * from habit_private.operation_receipts; raise exception 'FAIL private receipt read'; exception when insufficient_privilege then null; end;
  begin perform habit_private.schedule('{"kind":"daily"}'); raise exception 'FAIL helper execute'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Explicitly simulate admin retention inside this rolled-back local fixture.
update habit_private.sync_heads set retained_after=3 where user_id='00000000-0000-0000-0000-000000000002';
delete from habit_private.change_events where user_id='00000000-0000-0000-0000-000000000002' and sequence<=3;
set local role authenticated;
do $$ begin
  begin perform habit_api.pull_changes('0'); raise exception 'FAIL expired cursor'; exception when sqlstate 'PT410' then if sqlerrm<>'full_resync_required' then raise; end if; end;
end $$;
select pg_temp.assert(habit_api.pull_changes('3',null,500)->>'next_cursor'='11','retention boundary resumes');
reset role;
-- Check ownership posture and explicit execution grants.
select pg_temp.assert(not (select rolbypassrls or rolsuper or rolcanlogin from pg_roles where rolname='habit_rpc_owner'),'owner no login/bypass/superuser');
select pg_temp.assert(not pg_has_role('authenticated','habit_rpc_owner','MEMBER'),'clients cannot SET ROLE API owner');
select pg_temp.assert(current_setting('server_version_num')::integer < 160000 or exists(select 1 from pg_auth_members m join pg_roles member_role on member_role.oid=m.member join pg_roles target_role on target_role.oid=m.roleid where member_role.rolname='managed_migration_admin' and target_role.rolname='habit_rpc_owner' and m.admin_option),'PG16 migration administrator retains management capability');
select pg_temp.assert(not has_schema_privilege('habit_rpc_owner','habit_api','CREATE') and not has_schema_privilege('habit_rpc_owner','habit_private','CREATE'),'temporary schema CREATE revoked');
select pg_temp.assert(not has_function_privilege('anon','habit_api.apply_operations(jsonb)','EXECUTE'),'anon execute revoked');
select pg_temp.assert(not has_function_privilege('authenticated','habit_private.schedule(jsonb)','EXECUTE'),'private helper execute revoked');
-- Audit every function, not just the primary write RPC.
select pg_temp.assert(not exists(
  select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('habit_api','habit_private') and
    (p.proowner <> 'habit_rpc_owner'::regrole or not coalesce(p.proconfig @> array['search_path=""'],false)
     or has_function_privilege('anon',p.oid,'EXECUTE')
     or (n.nspname='habit_private' and has_function_privilege('authenticated',p.oid,'EXECUTE')))
),'all function owners, fixed search_path and execute boundaries');
select pg_temp.assert((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='habit_api' and p.prosecdef)=4,'only four public definer entry points');
select pg_temp.assert(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('habit_api','habit_private') and c.relkind='r' and
    (not c.relrowsecurity or not c.relforcerowsecurity or c.relowner='habit_rpc_owner'::regrole
     or has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES'))),
  'every table forced RLS, separate owner, no direct client write grants');
rollback;
\echo 'PASS sync API auth, isolation, CAS, idempotency, business rules, paging, tombstones and rollback'
