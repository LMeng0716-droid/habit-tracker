-- REVIEW REQUIRED. Apply manually only to the verified mobile cloud test project.
-- Not the V3 sandbox and not the old local-only app.
-- Prerequisite: habit_mobile schema from 202610110001_mobile_cloud.sql.
-- Safe additive extension: no table/data deletion, no Auth changes.
begin;
set local lock_timeout = '5s';

do $precheck$
begin
  if to_regclass('habit_mobile.habits') is null
     or to_regprocedure('habit_mobile.archive_habit(text)') is null then
    raise exception 'mobile_cloud_base_missing';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='habit_mobile' and table_name='habits'
      and column_name='habit_type'
  ) then
    raise exception 'v3_schema_detected_use_separate_reviewed_migration';
  end if;
end $precheck$;

-- Keep the existing identity and archive-date checks. For an already archived
-- row, permit only archived_on => NULL with the same name and color.
create or replace function habit_mobile.guard_habit() returns trigger
language plpgsql security invoker set search_path='' as $$
declare today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
begin
  if auth.uid() is null or new.user_id<>auth.uid() then
    raise exception using errcode='42501',message='authentication_required';
  end if;
  if tg_op='INSERT' then
    new.created_date:=today; new.created_at:=clock_timestamp(); new.archived_on:=null;
  else
    if old.archived_on is not null
       and (new.archived_on is not null
         or new.name is distinct from old.name
         or new.color is distinct from old.color) then
      raise exception 'habit_archived';
    end if;
    if new.user_id<>old.user_id or new.id<>old.id
       or new.created_date<>old.created_date
       or new.created_at<>old.created_at then
      raise exception 'immutable_identity';
    end if;
    if new.archived_on is not null and new.archived_on<>today then
      raise exception 'invalid_archive_date';
    end if;
  end if;
  return new;
end $$;

create or replace function habit_mobile.restore_habit(p_id text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare h habit_mobile.habits%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication_required';
  end if;
  select * into h from habit_mobile.habits
    where user_id=auth.uid() and id=p_id for update;
  if h.id is null then raise exception 'habit_not_found'; end if;
  if h.archived_on is not null then
    update habit_mobile.habits set archived_on=null
      where user_id=auth.uid() and id=p_id returning * into h;
  end if;
  return to_jsonb(h);
end $$;

revoke all on function habit_mobile.restore_habit(text) from public,anon,authenticated;
grant execute on function habit_mobile.restore_habit(text) to authenticated;
notify pgrst,'reload schema';
commit;
