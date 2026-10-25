-- PROPOSAL ONLY. NOT EXECUTED. Requires separate explicit authorization.
-- Scope: habit-tracker-test / habit_mobile (not habit-tracker-v3-sandbox).
-- Changes: add emoji and ordering to habits, provide authenticated RLS-safe RPCs.
-- Preserves habit IDs, names, archive state, all checkins, and existing RPCs.
begin;
set local lock_timeout = '5s';

do $check$
begin
  if to_regclass('habit_mobile.habits') is null
     or to_regprocedure('habit_mobile.restore_habit(text)') is null then
    raise exception 'expected_mobile_schema_missing';
  end if;
  if exists (select 1 from information_schema.columns
    where table_schema='habit_mobile' and table_name='habits'
      and column_name='habit_type') then
    raise exception 'unexpected_v3_schema';
  end if;
end $check$;

alter table habit_mobile.habits
  add column if not exists emoji text not null default '🌱',
  add column if not exists sort_order bigint;

-- One-time deterministic initialization. Existing rows keep identity/history.
with ranked as (
  select user_id, id,
    row_number() over (partition by user_id order by created_at,id) * 1024 as position
  from habit_mobile.habits
)
update habit_mobile.habits h
  set sort_order=ranked.position
from ranked
where h.user_id=ranked.user_id and h.id=ranked.id and h.sort_order is null;

create or replace function habit_mobile.guard_habit()
returns trigger language plpgsql set search_path='' as $function$
declare
  today date := (clock_timestamp() at time zone 'Asia/Shanghai')::date;
begin
  if auth.uid() is null or new.user_id <> auth.uid() then
    raise exception using errcode='42501', message='authentication_required';
  end if;
  if tg_op='INSERT' then
    new.created_date := today;
    new.created_at := clock_timestamp();
    new.archived_on := null;
    -- Keep newly-created habits at the end, including when many devices create concurrently.
    perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 3917));
    select coalesce(max(sort_order),0) + 1024 into new.sort_order
      from habit_mobile.habits where user_id=auth.uid();
    new.emoji := coalesce(new.emoji,'🌱');
  else
    if old.archived_on is not null
       and (new.archived_on is not null
         or new.name is distinct from old.name
         or new.color is distinct from old.color
         or new.emoji is distinct from old.emoji) then
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
end $function$;

alter table habit_mobile.habits
  alter column sort_order set not null,
  add constraint habit_mobile_emoji_allowed
    check (emoji in ('🌱','📖','💪','🧘','💤','💧','🥗','🏃','🪥','🛁','🧴','🎨','🎯','☀️','❤️','✨')),
  add constraint habit_mobile_sort_nonnegative check (sort_order >= 0);

-- Existing guard_habit trigger remains enabled. The normal RLS ownership rule
-- still applies. RPCs are invoker (not definer) and explicitly owner-filtered.
grant update (emoji,sort_order) on habit_mobile.habits to authenticated;

create function habit_mobile.set_habit_emoji(p_id text, p_emoji text)
returns jsonb
language plpgsql security invoker set search_path='' as $$
declare h habit_mobile.habits%rowtype;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_emoji is null or p_emoji not in ('🌱','📖','💪','🧘','💤','💧','🥗','🏃','🪥','🛁','🧴','🎨','🎯','☀️','❤️','✨') then
    raise exception 'invalid_emoji';
  end if;
  update habit_mobile.habits set emoji=p_emoji
    where user_id=auth.uid() and id=p_id and archived_on is null returning * into h;
  if h.id is null then raise exception 'active_habit_not_found'; end if;
  return to_jsonb(h);
end $$;

create function habit_mobile.reorder_habits(p_ids text[])
returns void
language plpgsql security invoker set search_path='' as $$
declare requested integer; existing integer;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_ids is null then raise exception 'order_required'; end if;
  select count(*) into requested from unnest(p_ids) item;
  if requested > 500 or requested <> (select count(distinct item) from unnest(p_ids) item)
     or array_position(p_ids,null) is not null then raise exception 'invalid_order'; end if;
  -- Serialize reorder operations of the same account.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 3917));
  select count(*) into existing from habit_mobile.habits
    where user_id=auth.uid() and archived_on is null;
  if requested <> existing
     or exists (
       select 1 from unnest(p_ids) item
       where not exists (select 1 from habit_mobile.habits h
         where h.user_id=auth.uid() and h.id=item and h.archived_on is null)
     ) then raise exception 'order_habit_set_changed'; end if;
  update habit_mobile.habits h
    set sort_order=ordering.ordinality * 1024
  from unnest(p_ids) with ordinality ordering(id,ordinality)
  where h.user_id=auth.uid() and h.id=ordering.id and h.archived_on is null;
end $$;

revoke all on function habit_mobile.set_habit_emoji(text,text) from public,anon,authenticated;
revoke all on function habit_mobile.reorder_habits(text[]) from public,anon,authenticated;
grant execute on function habit_mobile.set_habit_emoji(text,text),
  habit_mobile.reorder_habits(text[]) to authenticated;
create or replace function habit_mobile.read_snapshot()
returns jsonb language plpgsql stable set search_path='' as $function$
declare result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication_required';
  end if;
  select jsonb_build_object(
    'today',(statement_timestamp() at time zone 'Asia/Shanghai')::date,
    'habits',(select coalesce(jsonb_agg(to_jsonb(h) order by sort_order,created_at,id),'[]'::jsonb)
      from habit_mobile.habits h where user_id=auth.uid()),
    'checkins',(select coalesce(jsonb_agg(to_jsonb(c) order by habit_id,date),'[]'::jsonb)
      from habit_mobile.habit_checkins c where user_id=auth.uid())
  ) into result;
  return result;
end $function$;

notify pgrst,'reload schema';
commit;
