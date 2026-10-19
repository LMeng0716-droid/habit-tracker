-- DRAFT / APPROVAL REQUIRED. NOT an active migration. Local disposable tests only.
-- Prerequisite: 202610110001_mobile_cloud.sql ONLY. Never run historical 001/002.
-- No custom roles, SECURITY DEFINER, Auth grants, owner changes or RLS bypass.
begin;
set local lock_timeout = '5s';
do $$ begin
  if current_setting('server_version_num')::integer < 150000 then raise exception 'PostgreSQL 15+ required'; end if;
  if to_regclass('habit_mobile.habits') is null or to_regprocedure('habit_mobile.read_snapshot()') is null then raise exception 'mobile_foundation_required'; end if;
  if to_regclass('habit_mobile.progress_operations') is not null then raise exception 'v3_already_installed_or_partial'; end if;
  if not has_schema_privilege('authenticated','auth','USAGE') or not has_function_privilege('authenticated','auth.uid()','EXECUTE') or not has_function_privilege('authenticated','pg_catalog.pg_advisory_xact_lock(bigint)','EXECUTE') then raise exception 'missing_runtime_permissions'; end if;
  if exists(select 1 from pg_roles where rolname in ('anon','authenticated') and (rolsuper or rolbypassrls)) then raise exception 'unsafe_client_role'; end if;
  if exists(select 1 from pg_class where oid in ('habit_mobile.habits'::regclass,'habit_mobile.habit_checkins'::regclass) and (not relrowsecurity or not relforcerowsecurity)) then raise exception 'foundation_rls_required'; end if;
end $$;
lock table habit_mobile.habits,habit_mobile.habit_checkins in share row exclusive mode;
alter table habit_mobile.habits
  add column emoji text not null default '🌱' check(emoji in ('🌱','📚','💧','🏃','🌙','🎨','🧘','🍎','🧹','✨')),
  add column sort_order bigint not null default 0 check(sort_order between 0 and 1000000000000),
  add column habit_type text not null default 'boolean',
  add column target integer not null default 1,
  add column unit text not null default 'completion',
  add constraint habit_mode_target check(
    (habit_type='boolean' and target=1 and unit='completion') or
    (habit_type='duration' and target between 1 and 1440 and unit='minute') or
    (habit_type='count' and target between 1 and 1000000 and unit='repetition'));
-- No UPDATE backfill: archived rows/identity timestamps/checkins remain intact.
-- Existing zero ranks use created_at,id as deterministic ties, preserving order.
create table habit_mobile.progress_operations (
  user_id uuid not null default auth.uid(),
  operation_id uuid not null,
  habit_id text not null,
  date date not null,
  action text not null check(action in ('add','set')),
  input_value bigint not null check(input_value between 0 and 1000000),
  expected_revision bigint check(expected_revision between 0 and 9007199254740991),
  value_after integer not null check(value_after between 0 and 1000000),
  revision bigint not null check(revision between 1 and 9007199254740991),
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_id,operation_id),
  unique(user_id,habit_id,date,revision),
  foreign key(user_id,habit_id) references habit_mobile.habits(user_id,id) on delete restrict,
  check((action='add' and input_value>0 and expected_revision is null) or
        (action='set' and expected_revision is not null))
);
create index progress_latest on habit_mobile.progress_operations(user_id,habit_id,date,revision desc) include(value_after);
alter table habit_mobile.progress_operations enable row level security;
alter table habit_mobile.progress_operations force row level security;
create policy own_read on habit_mobile.progress_operations for select to authenticated using((select auth.uid())=user_id);
create policy own_insert on habit_mobile.progress_operations for insert to authenticated with check((select auth.uid())=user_id);
revoke all on habit_mobile.progress_operations from public,anon,authenticated;
grant select on habit_mobile.progress_operations to authenticated;
-- Only command inputs are writable. Trigger assigns the immutable result/receipt.
grant insert(operation_id,habit_id,date,action,input_value,expected_revision) on habit_mobile.progress_operations to authenticated;

create function habit_mobile.require_user_v3() returns uuid
language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid(); begin
  if uid is null then raise exception using errcode='42501',message='authentication_required'; end if;
  -- Per-account serialization, not a global lock. No role escalation.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text,190001));
  return uid;
end $$;
revoke all on function habit_mobile.require_user_v3() from public,anon,authenticated;
grant execute on function habit_mobile.require_user_v3() to authenticated;

create or replace function habit_mobile.guard_habit() returns trigger
language plpgsql security invoker set search_path='' as $$
declare today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date; uid uuid; rank bigint;
begin
  uid:=habit_mobile.require_user_v3();
  if new.user_id<>uid then raise exception using errcode='42501',message='authentication_required'; end if;
  if tg_op='INSERT' then
    select coalesce(max(sort_order),0)+1024 into rank from habit_mobile.habits where user_id=uid;
    new.sort_order:=rank; new.created_date:=today; new.created_at:=clock_timestamp(); new.archived_on:=null;
  else
    if old.archived_on is not null then raise exception 'habit_archived'; end if;
    if new.user_id<>old.user_id or new.id<>old.id or new.created_date<>old.created_date or new.created_at<>old.created_at then raise exception 'immutable_identity'; end if;
    if new.habit_type<>old.habit_type or new.target<>old.target or new.unit<>old.unit then raise exception 'immutable_mode_target'; end if;
    if new.archived_on is not null and new.archived_on<>today then raise exception 'invalid_archive_date'; end if;
  end if;
  return new;
end $$;
create or replace function habit_mobile.guard_checkin() returns trigger
language plpgsql security invoker set search_path='' as $$
declare h habit_mobile.habits%rowtype; uid uuid; hid text; day date;
begin
  if tg_op='DELETE' then uid:=old.user_id; hid:=old.habit_id; day:=old.date;
  else uid:=new.user_id; hid:=new.habit_id; day:=new.date; new.created_at:=clock_timestamp(); end if;
  if auth.uid() is null or uid<>auth.uid() then raise exception using errcode='42501',message='authentication_required'; end if;
  perform habit_mobile.require_user_v3();
  select * into h from habit_mobile.habits where user_id=uid and id=hid for update;
  if h.id is null then raise exception 'habit_not_found'; end if;
  if h.habit_type<>'boolean' then raise exception 'v3_numeric_required'; end if;
  if h.archived_on is not null then raise exception 'habit_archived'; end if;
  if day is null or day<h.created_date or day>(clock_timestamp() at time zone 'Asia/Shanghai')::date then raise exception 'date_not_eligible'; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;

create function habit_mobile.guard_progress_v3() returns trigger
language plpgsql security invoker set search_path='' as $$
declare uid uuid; h habit_mobile.habits%rowtype; receipt habit_mobile.progress_operations%rowtype;
        prior bigint:=0; ver bigint:=0; result bigint; maximum bigint;
begin
  uid:=habit_mobile.require_user_v3();
  if new.user_id<>uid then raise exception using errcode='42501',message='authentication_required'; end if;
  if new.operation_id is null then raise exception 'operation_id_required'; end if;
  select * into receipt from habit_mobile.progress_operations where user_id=uid and operation_id=new.operation_id;
  if found then
    if receipt.habit_id is distinct from new.habit_id or receipt.date is distinct from new.date or receipt.action is distinct from new.action or receipt.input_value is distinct from new.input_value or receipt.expected_revision is distinct from new.expected_revision then raise exception 'operation_id_reused'; end if;
    return null; -- Identical retry: RPC reads the original immutable receipt.
  end if;
  select * into h from habit_mobile.habits where user_id=uid and id=new.habit_id for update;
  if h.id is null then raise exception 'habit_not_found'; end if;
  if h.habit_type='boolean' then raise exception 'boolean_checkin_required'; end if;
  if h.archived_on is not null then raise exception 'habit_archived'; end if;
  if new.date is null or new.date<h.created_date or new.date>(clock_timestamp() at time zone 'Asia/Shanghai')::date then raise exception 'date_not_eligible'; end if;
  maximum:=case when h.habit_type='duration' then 1440 else 1000000 end;
  select value_after,revision into prior,ver from habit_mobile.progress_operations
    where user_id=uid and habit_id=h.id and date=new.date order by revision desc limit 1;
  prior:=coalesce(prior,0); ver:=coalesce(ver,0);
  if new.input_value is null or new.input_value<0 or new.input_value>maximum then raise exception 'value_out_of_range'; end if;
  if new.action='add' and new.input_value>0 and new.expected_revision is null then result:=prior+new.input_value;
  elsif new.action='set' and new.expected_revision=ver then result:=new.input_value;
  elsif new.action='set' then raise exception using errcode='40001',message='revision_conflict';
  else raise exception 'invalid_progress_action'; end if;
  if result>maximum then raise exception 'value_out_of_range'; end if;
  if ver>=9007199254740991 then raise exception 'revision_limit'; end if;
  new.value_after:=result::integer; new.revision:=ver+1; new.created_at:=clock_timestamp();
  return new;
end $$;
revoke all on function habit_mobile.guard_progress_v3() from public,anon,authenticated;
create trigger guard_progress_v3 before insert on habit_mobile.progress_operations for each row execute function habit_mobile.guard_progress_v3();
create view habit_mobile.habit_daily_progress with(security_invoker=true) as
  select distinct on(user_id,habit_id,date) user_id,habit_id,date,value_after as actual_value,revision
  from habit_mobile.progress_operations order by user_id,habit_id,date,revision desc;
revoke all on habit_mobile.habit_daily_progress from public,anon,authenticated;
grant select on habit_mobile.habit_daily_progress to authenticated;
-- New public columns only, never identity/time/result columns.
grant insert(emoji,habit_type,target,unit) on habit_mobile.habits to authenticated;
grant update(emoji,sort_order) on habit_mobile.habits to authenticated;

create function habit_mobile.create_habit_v3(p_id text,p_name text,p_color integer,p_emoji text default '🌱',p_type text default 'boolean',p_target integer default 1,p_unit text default 'completion') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare uid uuid; h habit_mobile.habits%rowtype; begin
  uid:=habit_mobile.require_user_v3();
  insert into habit_mobile.habits(id,name,color,emoji,habit_type,target,unit) values(p_id,btrim(p_name),p_color,p_emoji,p_type,p_target,p_unit) on conflict(user_id,id) do nothing;
  select * into h from habit_mobile.habits where user_id=uid and id=p_id;
  if h.name is distinct from btrim(p_name) or h.color is distinct from p_color or h.emoji is distinct from p_emoji or h.habit_type is distinct from p_type or h.target is distinct from p_target or h.unit is distinct from p_unit or h.archived_on is not null then raise exception 'id_already_used'; end if;
  return to_jsonb(h);
end $$;
create function habit_mobile.edit_habit_v3(p_id text,p_name text,p_color integer,p_emoji text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare uid uuid; h habit_mobile.habits%rowtype; begin
  uid:=habit_mobile.require_user_v3();
  update habit_mobile.habits set name=btrim(p_name),color=p_color,emoji=p_emoji where user_id=uid and id=p_id returning * into h;
  if h.id is null then raise exception 'habit_not_found'; end if;
  return to_jsonb(h);
end $$;
create function habit_mobile.archive_habit_v3(p_id text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare uid uuid; h habit_mobile.habits%rowtype; begin
  uid:=habit_mobile.require_user_v3();
  select * into h from habit_mobile.habits where user_id=uid and id=p_id for update;
  if h.id is null then raise exception 'habit_not_found'; end if;
  if h.archived_on is null then update habit_mobile.habits set archived_on=(clock_timestamp() at time zone 'Asia/Shanghai')::date where user_id=uid and id=p_id returning * into h; end if;
  return to_jsonb(h);
end $$;
create function habit_mobile.record_progress_v3(p_operation_id uuid,p_habit_id text,p_date date,p_action text,p_value bigint,p_expected_revision bigint default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare uid uuid; receipt habit_mobile.progress_operations%rowtype; begin
  uid:=habit_mobile.require_user_v3();
  insert into habit_mobile.progress_operations(operation_id,habit_id,date,action,input_value,expected_revision)
    values(p_operation_id,p_habit_id,p_date,p_action,p_value,p_expected_revision) returning * into receipt;
  if receipt.operation_id is null then select * into receipt from habit_mobile.progress_operations where user_id=uid and operation_id=p_operation_id; end if;
  return to_jsonb(receipt);
end $$;
create function habit_mobile.reorder_habits_v3(p_ids text[],p_expected_ids text[]) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare uid uuid; current_ids text[]; begin
  uid:=habit_mobile.require_user_v3();
  select coalesce(array_agg(id order by sort_order,created_at,id),array[]::text[]) into current_ids from habit_mobile.habits where user_id=uid and archived_on is null;
  if p_ids is null or p_expected_ids is null or cardinality(p_ids)>500 or cardinality(p_expected_ids)>500 or array_ndims(p_ids)>1 or array_ndims(p_expected_ids)>1 or exists(select 1 from unnest(p_ids) v where v is null) or cardinality(p_ids)<>(select count(distinct v) from unnest(p_ids) v) or
    (select array_agg(v order by v) from unnest(p_ids) v) is distinct from (select array_agg(v order by v) from unnest(current_ids) v) then raise exception 'invalid_order_ids'; end if;
  if current_ids=p_ids then return jsonb_build_object('ids',current_ids,'unchanged',true); end if;
  if current_ids<>p_expected_ids then raise exception using errcode='40001',message='order_conflict'; end if;
  update habit_mobile.habits h set sort_order=o.rank from unnest(p_ids) with ordinality o(id,rank) where h.user_id=uid and h.id=o.id;
  return jsonb_build_object('ids',p_ids,'unchanged',false);
end $$;

-- Preserve old signatures; no overloaded function names/PostgREST ambiguity.
create or replace function habit_mobile.create_habit(p_id text,p_name text,p_color integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare uid uuid; h habit_mobile.habits%rowtype; begin
  uid:=habit_mobile.require_user_v3();
  insert into habit_mobile.habits(id,name,color) values(p_id,btrim(p_name),p_color) on conflict(user_id,id) do nothing;
  select * into h from habit_mobile.habits where user_id=uid and id=p_id;
  if h.name is distinct from btrim(p_name) or h.color is distinct from p_color or h.habit_type<>'boolean' or h.archived_on is not null then raise exception 'id_already_used'; end if;
  return to_jsonb(h);
end $$;
create or replace function habit_mobile.edit_habit(p_id text,p_name text,p_color integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare uid uuid; h habit_mobile.habits%rowtype; begin
  uid:=habit_mobile.require_user_v3();
  select * into h from habit_mobile.habits where user_id=uid and id=p_id;
  if h.id is null then raise exception 'habit_not_found'; end if;
  if h.habit_type<>'boolean' then raise exception 'v3_client_required'; end if;
  return habit_mobile.edit_habit_v3(p_id,p_name,p_color,h.emoji);
end $$;
create or replace function habit_mobile.archive_habit(p_id text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare uid uuid; h habit_mobile.habits%rowtype; begin
  uid:=habit_mobile.require_user_v3();
  select * into h from habit_mobile.habits where user_id=uid and id=p_id;
  if h.id is null then raise exception 'habit_not_found'; end if;
  if h.habit_type<>'boolean' then raise exception 'v3_client_required'; end if;
  return habit_mobile.archive_habit_v3(p_id);
end $$;
create or replace function habit_mobile.set_checkin(p_habit_id text,p_date date,p_completed boolean) returns void
language plpgsql security invoker set search_path='' as $$
declare uid uuid; h habit_mobile.habits%rowtype; begin
  uid:=habit_mobile.require_user_v3();
  if p_completed is null then raise exception 'completed_required'; end if;
  select * into h from habit_mobile.habits where user_id=uid and id=p_habit_id for update;
  if h.id is null then raise exception 'habit_not_found'; end if;
  if h.habit_type<>'boolean' then raise exception 'v3_numeric_required'; end if;
  if h.archived_on is not null then raise exception 'habit_archived'; end if;
  if p_date is null or p_date<h.created_date or p_date>(clock_timestamp() at time zone 'Asia/Shanghai')::date then raise exception 'date_not_eligible'; end if;
  if p_completed then insert into habit_mobile.habit_checkins(habit_id,date) values(p_habit_id,p_date) on conflict(user_id,habit_id,date) do nothing;
  else delete from habit_mobile.habit_checkins where user_id=uid and habit_id=p_habit_id and date=p_date; end if;
end $$;
create or replace function habit_mobile.read_snapshot() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select jsonb_build_object('today',(statement_timestamp() at time zone 'Asia/Shanghai')::date,
    'habits',(select coalesce(jsonb_agg(to_jsonb(h) order by created_at,id),'[]'::jsonb) from habit_mobile.habits h where user_id=auth.uid() and habit_type='boolean'),
    'checkins',(select coalesce(jsonb_agg(to_jsonb(c) order by habit_id,date),'[]'::jsonb) from habit_mobile.habit_checkins c join habit_mobile.habits h on h.user_id=c.user_id and h.id=c.habit_id where c.user_id=auth.uid() and h.habit_type='boolean')) into result;
  return result;
end $$;
create function habit_mobile.read_snapshot_v3(p_start date default ((statement_timestamp() at time zone 'Asia/Shanghai')::date-364),p_end date default ((statement_timestamp() at time zone 'Asia/Shanghai')::date),p_habit_id text default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; today date:=(statement_timestamp() at time zone 'Asia/Shanghai')::date; begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_start is null or p_end is null or p_start>p_end or p_end-p_start>365 or p_end>today then raise exception 'invalid_date_range'; end if;
  if p_habit_id is not null and not exists(select 1 from habit_mobile.habits where user_id=auth.uid() and id=p_habit_id) then raise exception 'habit_not_found'; end if;
  select jsonb_build_object('api_version',3,'today',today,'start',p_start,'end',p_end,
    'habits',(select coalesce(jsonb_agg(to_jsonb(h) order by sort_order,created_at,id),'[]'::jsonb) from habit_mobile.habits h where user_id=auth.uid()),
    'checkins',(select coalesce(jsonb_agg(to_jsonb(c) order by habit_id,date),'[]'::jsonb) from habit_mobile.habit_checkins c where user_id=auth.uid() and date between p_start and p_end and (p_habit_id is null or habit_id=p_habit_id)),
    'progress',(select coalesce(jsonb_agg(to_jsonb(p) order by habit_id,date),'[]'::jsonb) from habit_mobile.habit_daily_progress p where user_id=auth.uid() and date between p_start and p_end and (p_habit_id is null or habit_id=p_habit_id))) into result;
  return result;
end $$;
-- Bounded 366-row aggregate output, instead of sending every habit/day detail.
create function habit_mobile.read_summary_v3(p_start date,p_end date,p_habit_id text default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; today date:=(statement_timestamp() at time zone 'Asia/Shanghai')::date; begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_start is null or p_end is null or p_start>p_end or p_end-p_start>365 or p_end>today then raise exception 'invalid_date_range'; end if;
  if p_habit_id is not null and not exists(select 1 from habit_mobile.habits where user_id=auth.uid() and id=p_habit_id) then raise exception 'habit_not_found'; end if;
  with days as(select d::date as day from generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') d),
  eligible as(select d.day,h.id,h.habit_type,h.target from days d left join habit_mobile.habits h on h.user_id=auth.uid() and h.created_date<=d.day and (h.archived_on is null or d.day<=h.archived_on) and (p_habit_id is null or h.id=p_habit_id)),
  amounts as(select e.*,case when e.habit_type='boolean' then case when c.habit_id is not null then 1 else 0 end else coalesce(p.actual_value,0) end actual
    from eligible e left join habit_mobile.habit_checkins c on c.user_id=auth.uid() and c.habit_id=e.id and c.date=e.day
    left join habit_mobile.habit_daily_progress p on p.user_id=auth.uid() and p.habit_id=e.id and p.date=e.day),
  totals as(select day,count(id) due,count(*) filter(where id is not null and actual>=target) completed,
    count(id) filter(where habit_type='duration') duration_due,count(id) filter(where habit_type='count') count_due,
    coalesce(sum(actual) filter(where habit_type='duration'),0) actual_minutes,
    coalesce(sum(actual) filter(where habit_type='count'),0) actual_repetitions,
    round(100*avg(least(actual::numeric/nullif(target,0),1)) filter(where id is not null),2) progress_rate from amounts group by day),
  rated as(select *,round(100*completed::numeric/nullif(due,0),2) completion_rate from totals)
  select jsonb_build_object('start',p_start,'end',p_end,'today',today,'days',(select jsonb_agg(to_jsonb(r) order by day) from rated r),
    'due',(select sum(due) from rated),'completed',(select sum(completed) from rated),
    'completion_rate',(select round(100*sum(completed)::numeric/nullif(sum(due),0),2) from rated)) into result;
  return result;
end $$;
-- Full-history completion dates for derived streaks/badges; no achievements table.
create function habit_mobile.read_streaks_v3() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  with h as(select *,least(coalesce(archived_on,(statement_timestamp() at time zone 'Asia/Shanghai')::date),(statement_timestamp() at time zone 'Asia/Shanghai')::date) anchor from habit_mobile.habits where user_id=auth.uid()),
  days as(select c.habit_id,c.date from habit_mobile.habit_checkins c join h on c.habit_id=h.id where c.user_id=auth.uid() and h.habit_type='boolean' and c.date between h.created_date and h.anchor
    union all select p.habit_id,p.date from habit_mobile.habit_daily_progress p join h on p.habit_id=h.id where p.user_id=auth.uid() and p.actual_value>=h.target and p.date between h.created_date and h.anchor),
  numbered as(select *,date-(row_number() over(partition by habit_id order by date))::integer island from days),
  runs as(select habit_id,min(date) first_day,max(date) last_day,count(*) length from numbered group by habit_id,island),
  summaries as(select h.id,
    coalesce((select max(length) from runs r where r.habit_id=h.id),0) longest,
    coalesce((select length from runs r where r.habit_id=h.id and r.last_day=case when exists(select 1 from days d where d.habit_id=h.id and d.date=h.anchor) then h.anchor else h.anchor-1 end),0) current,
    (select coalesce(jsonb_agg(jsonb_build_object('days',t.n,'achieved_on',(select min(first_day+t.n-1) from runs r where r.habit_id=h.id and r.length>=t.n)) order by t.n),'[]'::jsonb) from (values(7),(21),(30)) t(n) where exists(select 1 from runs r where r.habit_id=h.id and r.length>=t.n)) badges from h)
  select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]'::jsonb) into result from summaries s;
  return result;
end $$;
revoke all on function habit_mobile.create_habit_v3(text,text,integer,text,text,integer,text),habit_mobile.edit_habit_v3(text,text,integer,text),habit_mobile.archive_habit_v3(text),habit_mobile.record_progress_v3(uuid,text,date,text,bigint,bigint),habit_mobile.reorder_habits_v3(text[],text[]),habit_mobile.read_snapshot_v3(date,date,text),habit_mobile.read_streaks_v3(),habit_mobile.read_summary_v3(date,date,text) from public,anon,authenticated;
grant execute on function habit_mobile.create_habit_v3(text,text,integer,text,text,integer,text),habit_mobile.edit_habit_v3(text,text,integer,text),habit_mobile.archive_habit_v3(text),habit_mobile.record_progress_v3(uuid,text,date,text,bigint,bigint),habit_mobile.reorder_habits_v3(text[],text[]),habit_mobile.read_snapshot_v3(date,date,text),habit_mobile.read_streaks_v3(),habit_mobile.read_summary_v3(date,date,text) to authenticated;
-- Reassert legacy ACLs explicitly; CREATE OR REPLACE alone preserves old ACLs.
revoke all on function habit_mobile.guard_habit(),habit_mobile.guard_checkin() from public,anon,authenticated;
revoke all on function habit_mobile.create_habit(text,text,integer),habit_mobile.edit_habit(text,text,integer),habit_mobile.archive_habit(text),habit_mobile.set_checkin(text,date,boolean),habit_mobile.read_snapshot() from public,anon,authenticated;
grant execute on function habit_mobile.create_habit(text,text,integer),habit_mobile.edit_habit(text,text,integer),habit_mobile.archive_habit(text),habit_mobile.set_checkin(text,date,boolean),habit_mobile.read_snapshot() to authenticated;
notify pgrst,'reload schema';
commit;
