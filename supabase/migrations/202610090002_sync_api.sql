-- Additive API migration; requires 202610090001 unchanged, PostgreSQL >=15.
-- Apply first to an isolated Supabase test project, never automatically in CI.
-- Migration administrator must be permitted to create/own the dedicated role.
begin;
create role habit_rpc_owner nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
-- PG16 automatically gives a CREATEROLE creator ADMIN on the new role.
-- Do not self-GRANT ADMIN again (PG16 rejects granting it back to a grantor).
-- Enable ordinary membership while retaining the creator's management grant.
grant habit_rpc_owner to current_user;
-- Temporary CREATE is needed for ALTER FUNCTION OWNER on non-superuser
-- migration administrators; revoked before this transaction commits.
grant create on schema habit_api, habit_private to habit_rpc_owner;
grant usage on schema auth, habit_api, habit_private to habit_rpc_owner;
grant execute on function auth.uid() to habit_rpc_owner;
grant select,insert,update on habit_api.user_profiles,habit_api.categories,habit_api.habits,
  habit_api.schedule_versions,habit_api.completions,habit_api.daily_notes,habit_api.habit_orders,
  habit_api.import_batches,habit_private.sync_heads,habit_private.change_events,habit_private.operation_receipts to habit_rpc_owner;
alter table habit_private.sync_heads add column retained_after bigint not null default 0
  check (retained_after >= 0 and retained_after <= last_sequence);

-- Dedicated role is not a table owner and cannot bypass FORCE RLS.
do $$ declare s text; t text; begin
  for s,t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and ((n.nspname='habit_api' and c.relname=any(array['user_profiles','categories','habits','schedule_versions','completions','daily_notes','habit_orders','import_batches'])) or (n.nspname='habit_private' and c.relname=any(array['sync_heads','change_events','operation_receipts'])))
  loop
    execute format('create policy rpc_owner_select on %I.%I for select to habit_rpc_owner using ((select auth.uid())=user_id)',s,t);
    execute format('create policy rpc_owner_insert on %I.%I for insert to habit_rpc_owner with check ((select auth.uid())=user_id)',s,t);
    execute format('create policy rpc_owner_update on %I.%I for update to habit_rpc_owner using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',s,t);
  end loop;
end $$;

create function habit_private.keys(p jsonb, allowed text[], required text[] default '{}') returns void
language plpgsql set search_path='' as $$
begin
  if jsonb_typeof(p) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p) k where not k=any(allowed))
    or not p ?& required then raise exception using errcode='22023',message='invalid_payload: unknown or missing fields'; end if;
end $$;
create function habit_private.version_check(expected bigint, current_row jsonb) returns void
language plpgsql set search_path='' as $$
begin
  if expected is null or expected < 0 then raise exception using errcode='22023',message='invalid_expected_version'; end if;
  if expected <> coalesce((current_row->>'version')::bigint,0) then
    raise exception using errcode='PT409',message='version_conflict',detail=jsonb_build_object('current',habit_private.wire(current_row),'current_version',coalesce(current_row->>'version','0'))::text;
  end if;
end $$;
create function habit_private.wire(p jsonb) returns jsonb language sql immutable set search_path='' as $$
 select case when p is null then null else p || jsonb_build_object('version',p->>'version') end
$$;
create function habit_private.parse_date(p text) returns date language plpgsql set search_path='' as $$
declare d date; begin
  if p is null or p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception using errcode='22023',message='invalid_date'; end if;
  d:=p::date;
  if d < date '1900-01-01' or to_char(d,'YYYY-MM-DD')<>p then raise exception using errcode='22023',message='invalid_date'; end if;
  return d;
end $$;
create function habit_private.schedule(p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare mask integer:=0; d jsonb; n integer; begin
  perform habit_private.keys(p,array['kind','days','count'],array['kind']);
  if p->>'kind'='daily' and not (p ? 'days' or p ? 'count') then return jsonb_build_object('kind','daily');
  elsif p->>'kind'='weekdays' and not p ? 'count' and jsonb_typeof(p->'days')='array' then
    if jsonb_array_length(p->'days') not between 1 and 7 then raise exception 'invalid_schedule'; end if;
    for d in select value from jsonb_array_elements(p->'days') loop
      if jsonb_typeof(d)<>'number' or d::text !~ '^[1-7]$' then raise exception 'invalid_schedule'; end if;
      n:=d::text::integer;
      if (mask & (1 << (n-1)))<>0 then raise exception 'invalid_schedule'; end if;
      mask:=mask | (1 << (n-1));
    end loop;
    return jsonb_build_object('kind','weekdays','mask',mask);
  elsif p->>'kind'='weeklyQuota' and not p ? 'days' and jsonb_typeof(p->'count')='number' and (p->>'count') ~ '^[1-7]$' then
    return jsonb_build_object('kind','weeklyQuota','count',(p->>'count')::integer);
  end if;
  raise exception using errcode='22023',message='invalid_schedule';
end $$;

-- All business writes emit immutable after-images in their transaction.
-- Only API owner can write tables; operation context cannot grant a client rights.
create function habit_private.before_business_write() returns trigger
language plpgsql set search_path='' as $$
begin
  if auth.uid() is null or new.user_id<>auth.uid() or nullif(current_setting('habit.operation_id',true),'') is null then
    raise exception using errcode='42501',message='authenticated_operation_required'; end if;
  if tg_op='INSERT' then new.version:=1; new.created_at:=clock_timestamp();
  else
    if new.user_id<>old.user_id or new.created_at<>old.created_at then raise exception 'immutable_identity'; end if;
    new.version:=old.version+1;
  end if;
  new.updated_at:=clock_timestamp();
  return new;
end $$;
create function habit_private.after_business_write() returns trigger
language plpgsql set search_path='' as $$
declare seq bigint; typ text; k jsonb; p jsonb:=to_jsonb(new); begin
  if tg_table_name='user_profiles' then
    insert into habit_private.sync_heads(user_id) values(new.user_id) on conflict do nothing;
  end if;
  update habit_private.sync_heads set last_sequence=last_sequence+1 where user_id=new.user_id returning last_sequence into seq;
  if seq is null then raise exception 'bootstrap_required'; end if;
  typ:=case tg_table_name when 'user_profiles' then 'profile' when 'categories' then 'category' when 'habits' then 'habit' when 'schedule_versions' then 'schedule' when 'completions' then 'completion' when 'daily_notes' then 'note' when 'habit_orders' then 'order' when 'import_batches' then 'import' end;
  k:=case when typ='completion' then jsonb_build_object('habit_id',p->'habit_id','date',p->'date') when typ in ('profile','order') then '{}'::jsonb else jsonb_build_object('id',p->'id') end;
  insert into habit_private.change_events(user_id,sequence,entity_type,entity_key,entity_version,payload,operation_id)
    values(new.user_id,seq,typ,k,new.version,habit_private.wire(p),current_setting('habit.operation_id')::uuid);
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['user_profiles','categories','habits','schedule_versions','completions','daily_notes','habit_orders','import_batches'] loop
    execute format('create trigger version_and_time before insert or update on habit_api.%I for each row execute function habit_private.before_business_write()',t);
    execute format('create trigger append_change after insert or update on habit_api.%I for each row execute function habit_private.after_business_write()',t);
  end loop;
end $$;

create function habit_api.apply_operations(p_operations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare
  uid uuid:=auth.uid(); op jsonb; d jsonb; typ text; oid uuid; hash text; receipt habit_private.operation_receipts%rowtype;
  expected bigint; current_row jsonb; result jsonb; results jsonb:='[]'; id text; hid text; dt date; today date; tz text;
  h habit_api.habits%rowtype; plan habit_api.schedule_versions%rowtype; sched jsonb; ids text[]; head bigint; before_head bigint;
  i integer; names text[]:=array['学习','运动','生活','健康','工作','其他'];
begin
  if uid is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if jsonb_typeof(p_operations) is distinct from 'array' or jsonb_array_length(p_operations) not between 1 and 100
    or octet_length(p_operations::text)>262144 then raise exception using errcode='22023',message='invalid_batch: 1..100 operations, max 256 KiB'; end if;
  -- Advisory lock also serializes first bootstrap (no sync_heads row yet).
  -- Hash collision can only serialize unrelated users, never expose data.
  perform pg_advisory_xact_lock(hashtextextended(uid::text,731281));
  perform 1 from habit_private.sync_heads where user_id=uid for update;
  for op in select value from jsonb_array_elements(p_operations) loop
    perform habit_private.keys(op,array['operation_id','type','expected_version','data'],array['operation_id','type','expected_version','data']);
    if jsonb_typeof(op->'operation_id') is distinct from 'string' or jsonb_typeof(op->'type') is distinct from 'string'
      or jsonb_typeof(op->'expected_version') is distinct from 'string' or (op->>'expected_version') !~ '^(0|[1-9][0-9]*)$'
      then raise exception using errcode='22023',message='invalid_operation_envelope'; end if;
    oid:=(op->>'operation_id')::uuid; typ:=op->>'type'; expected:=(op->>'expected_version')::bigint; d:=op->'data';
    hash:=encode(sha256(convert_to(op::text,'UTF8')),'hex');
    select * into receipt from habit_private.operation_receipts where user_id=uid and operation_id=oid;
    if found then
      if receipt.payload_sha256<>hash then raise exception using errcode='22023',message='operation_id_reused_with_different_payload'; end if;
      results:=results||jsonb_build_array(receipt.result); continue;
    end if;
    perform set_config('habit.operation_id',oid::text,true);
    select last_sequence into before_head from habit_private.sync_heads where user_id=uid;
    if typ='bootstrap' then
      perform habit_private.keys(d,array['timezone'],array['timezone']);
      if jsonb_typeof(d->'timezone') is distinct from 'string' or not exists(select 1 from pg_catalog.pg_timezone_names where name=d->>'timezone') then raise exception 'invalid_timezone'; end if;
      select to_jsonb(p) into current_row from habit_api.user_profiles p where user_id=uid;
      if current_row is null then
        perform habit_private.version_check(expected,current_row);
        insert into habit_api.user_profiles(user_id,calendar_timezone) values(uid,d->>'timezone');
        for i in 1..6 loop insert into habit_api.categories(user_id,id,name,preset) values(uid,'preset-'||(i-1),names[i],true); end loop;
        insert into habit_api.habit_orders(user_id) values(uid);
      elsif not exists(select 1 from habit_private.sync_heads where user_id=uid)
        or not exists(select 1 from habit_api.habit_orders where user_id=uid) then
        raise exception using errcode='55000',message='bootstrap_state_incomplete';
      end if;
    else
      select calendar_timezone into tz from habit_api.user_profiles where user_id=uid and deleted_at is null;
      if tz is null then raise exception using errcode='55000',message='bootstrap_required'; end if;
      today:=(clock_timestamp() at time zone tz)::date;
      id:=d->>'id'; hid:=d->>'habit_id'; current_row:=null;
      case typ
      when 'profile_update' then
        perform habit_private.keys(d,array['timezone'],array['timezone']);
        if jsonb_typeof(d->'timezone') is distinct from 'string' or not exists(select 1 from pg_catalog.pg_timezone_names where name=d->>'timezone') then raise exception 'invalid_timezone'; end if;
        select to_jsonb(p) into current_row from habit_api.user_profiles p where user_id=uid;
        perform habit_private.version_check(expected,current_row);
        update habit_api.user_profiles set calendar_timezone=d->>'timezone' where user_id=uid;
      when 'category_create','category_update','category_delete' then
        perform habit_private.keys(d,case when typ='category_delete' then array['id'] else array['id','name'] end,case when typ='category_delete' then array['id'] else array['id','name'] end);
        if jsonb_typeof(d->'id') is distinct from 'string' then raise exception 'invalid_id'; end if;
        select to_jsonb(c) into current_row from habit_api.categories c where user_id=uid and c.id=id;
        perform habit_private.version_check(expected,current_row);
        if typ='category_create' then
          if current_row is not null then raise exception 'entity_already_exists'; end if;
          if jsonb_typeof(d->'name') is distinct from 'string' then raise exception 'invalid_name'; end if;
          insert into habit_api.categories(user_id,id,name) values(uid,id,d->>'name');
        else
          if current_row is null or current_row->>'deleted_at' is not null then raise exception 'entity_not_found'; end if;
          if (current_row->>'preset')::boolean then raise exception 'preset_category_is_immutable'; end if;
          if typ='category_update' then
            if jsonb_typeof(d->'name') is distinct from 'string' then raise exception 'invalid_name'; end if;
            update habit_api.categories set name=d->>'name' where user_id=uid and categories.id=id;
          else
            update habit_api.habits set category_id=null where user_id=uid and category_id=id and deleted_at is null;
            update habit_api.categories set deleted_at=clock_timestamp() where user_id=uid and categories.id=id;
          end if;
        end if;
      when 'habit_create','habit_update','habit_archive','habit_delete' then
        perform habit_private.keys(d,
          case typ when 'habit_create' then array['id','name','color','category_id','created_date','created_at_ms','plan_id','schedule','order_version'] when 'habit_update' then array['id','name','color','category_id'] else array['id'] end,
          case typ when 'habit_create' then array['id','name','color','category_id','created_date','created_at_ms','plan_id','schedule','order_version'] when 'habit_update' then array['id','name','color','category_id'] else array['id'] end);
        if jsonb_typeof(d->'id') is distinct from 'string' then raise exception 'invalid_id'; end if;
        select * into h from habit_api.habits where user_id=uid and habits.id=id;
        select to_jsonb(x) into current_row from habit_api.habits x where user_id=uid and x.id=id;
        perform habit_private.version_check(expected,current_row);
        if typ in ('habit_create','habit_update') then
          if jsonb_typeof(d->'name') is distinct from 'string' or jsonb_typeof(d->'color') is distinct from 'number'
            or (d->>'color') !~ '^[0-4]$' or jsonb_typeof(d->'category_id') not in ('null','string') then raise exception 'invalid_habit'; end if;
          if d->>'category_id' is not null and not exists(select 1 from habit_api.categories where user_id=uid and categories.id=d->>'category_id' and deleted_at is null) then raise exception 'category_not_found'; end if;
        end if;
        if typ='habit_create' then
          if current_row is not null then raise exception 'entity_already_exists'; end if;
          dt:=habit_private.parse_date(d->>'created_date');
          if dt>today or jsonb_typeof(d->'created_at_ms') is distinct from 'number' or (d->>'created_at_ms') !~ '^[0-9]+$'
            or (d->>'created_at_ms')::numeric > 9007199254740991 or jsonb_typeof(d->'plan_id') is distinct from 'string'
            or jsonb_typeof(d->'order_version') is distinct from 'string' or (d->>'order_version') !~ '^[1-9][0-9]*$' then raise exception 'invalid_habit_origin'; end if;
          select to_jsonb(o) into current_row from habit_api.habit_orders o where user_id=uid;
          perform habit_private.version_check((d->>'order_version')::bigint,current_row);
          sched:=habit_private.schedule(d->'schedule');
          insert into habit_api.habits(user_id,id,name,color,category_id,created_date,legacy_created_at_ms)
            values(uid,id,d->>'name',(d->>'color')::smallint,d->>'category_id',dt,(d->>'created_at_ms')::bigint);
          insert into habit_api.schedule_versions(user_id,id,habit_id,effective_date,kind,weekday_mask,weekly_target)
            values(uid,d->>'plan_id',id,dt,sched->>'kind',(sched->>'mask')::smallint,(sched->>'count')::smallint);
          update habit_api.habit_orders set ordered_habit_ids=array_append(ordered_habit_ids,id) where user_id=uid;
        else
          if h.id is null or h.deleted_at is not null then raise exception 'entity_not_found'; end if;
          if typ='habit_update' then
            if h.archived_date is not null then raise exception 'habit_archived'; end if;
            update habit_api.habits set name=d->>'name',color=(d->>'color')::smallint,category_id=d->>'category_id' where user_id=uid and habits.id=id;
          elsif typ='habit_archive' then
            if h.archived_date is not null or today<h.created_date then raise exception 'invalid_archive'; end if;
            update habit_api.habits set archived_date=today where user_id=uid and habits.id=id;
            update habit_api.completions set completed=false where user_id=uid and habit_id=id and date=today and completed and deleted_at is null;
          else
            update habit_api.habits set deleted_at=clock_timestamp() where user_id=uid and habits.id=id;
            update habit_api.schedule_versions set deleted_at=clock_timestamp() where user_id=uid and habit_id=id and deleted_at is null;
            update habit_api.completions set deleted_at=clock_timestamp(),completed=false where user_id=uid and habit_id=id and deleted_at is null;
            update habit_api.daily_notes set deleted_at=clock_timestamp() where user_id=uid and habit_id=id and deleted_at is null;
            update habit_api.habit_orders set ordered_habit_ids=array_remove(ordered_habit_ids,id) where user_id=uid;
          end if;
        end if;
      when 'plan_set' then
        perform habit_private.keys(d,array['habit_id','id','schedule'],array['habit_id','id','schedule']);
        if jsonb_typeof(d->'habit_id') is distinct from 'string' or jsonb_typeof(d->'id') is distinct from 'string' then raise exception 'invalid_id'; end if;
        select * into h from habit_api.habits where user_id=uid and habits.id=hid and deleted_at is null;
        if h.id is null or h.archived_date is not null then raise exception 'habit_not_active'; end if;
        dt:=today-(extract(isodow from today)::integer-1)+7;
        select to_jsonb(p) into current_row from habit_api.schedule_versions p where user_id=uid and habit_id=hid and effective_date=dt;
        perform habit_private.version_check(expected,current_row);
        sched:=habit_private.schedule(d->'schedule');
        if current_row is null then
          insert into habit_api.schedule_versions(user_id,id,habit_id,effective_date,kind,weekday_mask,weekly_target)
            values(uid,id,hid,dt,sched->>'kind',(sched->>'mask')::smallint,(sched->>'count')::smallint);
        else
          if current_row->>'id'<>id or current_row->>'deleted_at' is not null then raise exception 'immutable_plan_id'; end if;
          update habit_api.schedule_versions set kind=sched->>'kind',weekday_mask=(sched->>'mask')::smallint,weekly_target=(sched->>'count')::smallint
            where user_id=uid and schedule_versions.id=id;
        end if;
      when 'completion_set','note_set' then
        perform habit_private.keys(d,case when typ='completion_set' then array['habit_id','date','completed'] else array['habit_id','date','body'] end,
          case when typ='completion_set' then array['habit_id','date','completed'] else array['habit_id','date','body'] end);
        if jsonb_typeof(d->'habit_id') not in ('string','null') or (typ='completion_set' and hid is null) then raise exception 'invalid_habit_id'; end if;
        dt:=habit_private.parse_date(d->>'date');
        if dt>today then raise exception 'future_date'; end if;
        if hid is not null then
          select * into h from habit_api.habits where user_id=uid and habits.id=hid and deleted_at is null;
          if h.id is null or dt<h.created_date then raise exception 'habit_date_not_eligible'; end if;
          if typ='completion_set' then
            if h.archived_date is not null then raise exception 'habit_archived'; end if;
            select * into plan from habit_api.schedule_versions where user_id=uid and habit_id=hid and effective_date<=dt and deleted_at is null order by effective_date desc limit 1;
            if plan.id is null or (plan.kind='weekdays' and (plan.weekday_mask::integer & (1 << (extract(isodow from dt)::integer-1)))=0) then raise exception 'unplanned_date'; end if;
          elsif h.archived_date is not null and dt>h.archived_date then raise exception 'habit_date_not_eligible'; end if;
        end if;
        if typ='completion_set' then
          if jsonb_typeof(d->'completed') is distinct from 'boolean' then raise exception 'invalid_completion'; end if;
          select to_jsonb(c) into current_row from habit_api.completions c where user_id=uid and habit_id=hid and date=dt;
          perform habit_private.version_check(expected,current_row);
          if current_row is null then insert into habit_api.completions(user_id,habit_id,date,completed) values(uid,hid,dt,(d->>'completed')::boolean);
          else
            if current_row->>'deleted_at' is not null then raise exception 'entity_deleted'; end if;
            update habit_api.completions set completed=(d->>'completed')::boolean where user_id=uid and habit_id=hid and date=dt;
          end if;
        else
          if jsonb_typeof(d->'body') is distinct from 'string' then raise exception 'invalid_note'; end if;
          id:='['||coalesce(to_json(hid)::text,'null')||','||to_json(dt::text)::text||']';
          select to_jsonb(n) into current_row from habit_api.daily_notes n where user_id=uid and habit_id is not distinct from hid and date=dt;
          perform habit_private.version_check(expected,current_row);
          if current_row is null then insert into habit_api.daily_notes(user_id,id,habit_id,date,body,deleted_at) values(uid,id,hid,dt,d->>'body',case when btrim(d->>'body')='' then clock_timestamp() end);
          else update habit_api.daily_notes set body=d->>'body',deleted_at=case when btrim(d->>'body')='' then clock_timestamp() end where user_id=uid and daily_notes.id=current_row->>'id'; end if;
        end if;
      when 'reorder' then
        perform habit_private.keys(d,array['ids'],array['ids']);
        if jsonb_typeof(d->'ids') is distinct from 'array' or jsonb_array_length(d->'ids')>10000
          or exists(select 1 from jsonb_array_elements(d->'ids') v where jsonb_typeof(v)<>'string') then raise exception 'invalid_order'; end if;
        select coalesce(array_agg(value order by ord),'{}'::text[]) into ids from jsonb_array_elements_text(d->'ids') with ordinality a(value,ord);
        if cardinality(ids)<>(select count(distinct x) from unnest(ids) x)
          or cardinality(ids)<>(select count(*) from habit_api.habits where user_id=uid and deleted_at is null)
          or exists(select 1 from unnest(ids) x where not exists(select 1 from habit_api.habits where user_id=uid and habits.id=x and deleted_at is null)) then raise exception 'invalid_order_membership'; end if;
        select to_jsonb(o) into current_row from habit_api.habit_orders o where user_id=uid;
        perform habit_private.version_check(expected,current_row);
        update habit_api.habit_orders set ordered_habit_ids=ids where user_id=uid;
      else raise exception using errcode='22023',message='unsupported_operation';
      end case;
    end if;
    select last_sequence into head from habit_private.sync_heads where user_id=uid;
    result:=jsonb_build_object('operation_id',oid,'status','committed','from_cursor',coalesce(before_head,0)::text,'cursor',head::text);
    insert into habit_private.operation_receipts(user_id,operation_id,payload_sha256,result) values(uid,oid,hash,result);
    results:=results||jsonb_build_array(result);
  end loop;
  perform set_config('habit.operation_id','',true);
  return jsonb_build_object('results',results);
end $$;

create function habit_api.bootstrap_user(p_operation_id uuid,p_timezone text default 'Asia/Shanghai') returns jsonb
language sql security definer set search_path='' as $$
 select habit_api.apply_operations(jsonb_build_array(jsonb_build_object('operation_id',p_operation_id,'type','bootstrap','expected_version','0','data',jsonb_build_object('timezone',p_timezone))))
$$;

create function habit_api.full_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); head bigint; result jsonb; begin
  if uid is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select last_sequence into head from habit_private.sync_heads where user_id=uid for share;
  if head is null then raise exception using errcode='55000',message='bootstrap_required'; end if;
  -- SHARE lock blocks all writers until every entity collection has been read.
  select jsonb_build_object('api_version',1,'cursor',head::text,
    'profile',(select habit_private.wire(to_jsonb(p)) from habit_api.user_profiles p where user_id=uid),
    'categories',(select coalesce(jsonb_agg(habit_private.wire(to_jsonb(c)) order by id),'[]') from habit_api.categories c where user_id=uid),
    'habits',(select coalesce(jsonb_agg(habit_private.wire(to_jsonb(h)) order by id),'[]') from habit_api.habits h where user_id=uid),
    'schedules',(select coalesce(jsonb_agg(habit_private.wire(to_jsonb(p)) order by habit_id,effective_date),'[]') from habit_api.schedule_versions p where user_id=uid),
    'completions',(select coalesce(jsonb_agg(habit_private.wire(to_jsonb(c)) order by habit_id,date),'[]') from habit_api.completions c where user_id=uid),
    'notes',(select coalesce(jsonb_agg(habit_private.wire(to_jsonb(n)) order by id),'[]') from habit_api.daily_notes n where user_id=uid),
    'order',(select habit_private.wire(to_jsonb(o)) from habit_api.habit_orders o where user_id=uid),
    'imports',(select coalesce(jsonb_agg(habit_private.wire(to_jsonb(b)) order by id),'[]') from habit_api.import_batches b where user_id=uid)) into result;
  return result;
end $$;
create function habit_api.pull_changes(p_after text,p_high_water text default null,p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); after_seq bigint; high bigint; head bigint; floor_seq bigint; events jsonb; next_seq bigint; begin
  if uid is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_after is null or p_after !~ '^(0|[1-9][0-9]*)$' or (p_high_water is not null and p_high_water !~ '^(0|[1-9][0-9]*)$')
    or p_limit is null or p_limit not between 1 and 500 then raise exception using errcode='22023',message='invalid_cursor_or_limit'; end if;
  after_seq:=p_after::bigint;
  select last_sequence,retained_after into head,floor_seq from habit_private.sync_heads where user_id=uid for share;
  if head is null then raise exception using errcode='55000',message='bootstrap_required'; end if;
  high:=coalesce(p_high_water::bigint,head);
  if after_seq<floor_seq then raise exception using errcode='PT410',message='full_resync_required',detail=jsonb_build_object('retained_after',floor_seq::text)::text; end if;
  if high>head or after_seq>high then raise exception using errcode='22023',message='invalid_cursor_range'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('sequence',sequence::text,'entity_type',entity_type,'entity_key',entity_key,'version',entity_version::text,'payload',payload,'operation_id',operation_id) order by sequence),'[]'),max(sequence)
    into events,next_seq from (select * from habit_private.change_events where user_id=uid and sequence>after_seq and sequence<=high order by sequence limit p_limit) page;
  next_seq:=coalesce(next_seq,high);
  return jsonb_build_object('events',events,'high_water',high::text,'next_cursor',next_seq::text,'has_more',next_seq<high);
end $$;

-- Own every new function with the constrained role, revoke implicit PUBLIC
-- EXECUTE inside this transaction. No CREATE schema privilege for API owner.
do $$ declare signature text; begin
  foreach signature in array array[
    'habit_private.keys(jsonb,text[],text[])','habit_private.version_check(bigint,jsonb)',
    'habit_private.wire(jsonb)','habit_private.parse_date(text)','habit_private.schedule(jsonb)',
    'habit_private.before_business_write()','habit_private.after_business_write()',
    'habit_api.apply_operations(jsonb)','habit_api.bootstrap_user(uuid,text)',
    'habit_api.full_snapshot()','habit_api.pull_changes(text,text,integer)'
  ] loop
    execute format('alter function %s owner to habit_rpc_owner',signature);
    execute format('revoke all on function %s from public,anon,authenticated',signature);
  end loop;
end $$;
grant execute on function habit_api.bootstrap_user(uuid,text),habit_api.apply_operations(jsonb),habit_api.full_snapshot(),habit_api.pull_changes(text,text,integer) to authenticated;
revoke create on schema habit_api,habit_private from habit_rpc_owner;
-- Keep ADMIN membership only for the trusted migration administrator so future
-- migrations/revocation can manage this NOLOGIN function owner (PG16 requires
-- ADMIN OPTION to grant/manage roles). Never grant membership to API clients.
-- Reassert the client privilege boundary even if the project had manual drift.
revoke insert,update,delete,truncate,references,trigger on habit_api.user_profiles,habit_api.categories,habit_api.habits,
  habit_api.schedule_versions,habit_api.completions,habit_api.daily_notes,habit_api.habit_orders,habit_api.import_batches
  from public,anon,authenticated;
revoke all on habit_private.sync_heads,habit_private.change_events,habit_private.operation_receipts from public,anon,authenticated;
revoke all on schema habit_private from public,anon,authenticated;
-- No direct business-table or private-schema permissions for clients.
notify pgrst,'reload schema';
commit;
