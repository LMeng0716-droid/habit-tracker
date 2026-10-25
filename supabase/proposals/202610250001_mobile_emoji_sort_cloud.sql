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
notify pgrst,'reload schema';
commit;
