-- Proposal only: DO NOT EXECUTE without separate user approval.
-- Target: habit-tracker-test / habit_mobile. Does not change other projects.
-- Allow a single keyboard emoji sequence in an existing cloud emoji field.
-- Preserve habit rows, user IDs, checkins, archived state, and existing RPCs.
begin;
set local lock_timeout='5s';
do $$
begin
  if to_regclass('habit_mobile.habits') is null
     or to_regprocedure('habit_mobile.set_habit_emoji(text,text)') is null
     or to_regprocedure('habit_mobile.reorder_habits(text[])') is null then
    raise exception 'mobile_cloud_emoji_schema_missing';
  end if;
end $$;
alter table habit_mobile.habits drop constraint if exists habit_mobile_emoji_allowed;
alter table habit_mobile.habits add constraint habit_mobile_emoji_safe
  check (char_length(emoji) between 1 and 16 and emoji !~ '[[:cntrl:]]');

create or replace function habit_mobile.set_habit_emoji(p_id text, p_emoji text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare h habit_mobile.habits%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication_required';
  end if;
  if p_emoji is null or char_length(p_emoji) not between 1 and 16
     or p_emoji ~ '[[:cntrl:]]' then
    raise exception 'invalid_emoji';
  end if;
  update habit_mobile.habits
    set emoji=p_emoji where user_id=auth.uid() and id=p_id and archived_on is null
    returning * into h;
  if h.id is null then raise exception 'active_habit_not_found'; end if;
  return to_jsonb(h);
end $$;
revoke all on function habit_mobile.set_habit_emoji(text,text) from public, anon, authenticated;
grant execute on function habit_mobile.set_habit_emoji(text,text) to authenticated;
notify pgrst,'reload schema';
commit;
