-- NEW mobile product. Apply this file alone, manually in an isolated project.
-- Do not run historical 001/002 first. Existing habit_api/private remain intact.
-- One-time, transactional migration; refuses existing habit_mobile objects.
begin;
create schema habit_mobile;
revoke all on schema habit_mobile from public, anon, authenticated;
grant usage on schema habit_mobile to authenticated;

create table habit_mobile.habits (
  user_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
  id text not null check (length(id) between 1 and 128),
  name text not null check (name=btrim(name) and char_length(name) between 1 and 30),
  color smallint not null default 0 check (color between 0 and 4),
  created_date date not null default ((clock_timestamp() at time zone 'Asia/Shanghai')::date),
  archived_on date check (archived_on>=created_date),
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_id,id)
);
create table habit_mobile.habit_checkins (
  user_id uuid not null default auth.uid(),
  habit_id text not null,
  date date not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_id,habit_id,date),
  foreign key(user_id,habit_id) references habit_mobile.habits(user_id,id) on delete restrict
);

alter table habit_mobile.habits enable row level security;
alter table habit_mobile.habits force row level security;
alter table habit_mobile.habit_checkins enable row level security;
alter table habit_mobile.habit_checkins force row level security;
create policy own_read on habit_mobile.habits for select to authenticated using ((select auth.uid())=user_id);
create policy own_insert on habit_mobile.habits for insert to authenticated with check ((select auth.uid())=user_id);
create policy own_update on habit_mobile.habits for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy own_read on habit_mobile.habit_checkins for select to authenticated using ((select auth.uid())=user_id);
create policy own_insert on habit_mobile.habit_checkins for insert to authenticated with check ((select auth.uid())=user_id);
create policy own_delete on habit_mobile.habit_checkins for delete to authenticated using ((select auth.uid())=user_id);

-- INVOKER throughout: no custom roles, Auth GRANT OPTION or ALTER OWNER.
create function habit_mobile.guard_habit() returns trigger
language plpgsql security invoker set search_path='' as $$
declare today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
begin
  if auth.uid() is null or new.user_id<>auth.uid() then raise exception using errcode='42501',message='authentication_required'; end if;
  if tg_op='INSERT' then
    new.created_date:=today; new.created_at:=clock_timestamp(); new.archived_on:=null;
  else
    if old.archived_on is not null then raise exception 'habit_archived'; end if;
    if new.user_id<>old.user_id or new.id<>old.id or new.created_date<>old.created_date or new.created_at<>old.created_at then raise exception 'immutable_identity'; end if;
    if new.archived_on is not null and new.archived_on<>today then raise exception 'invalid_archive_date'; end if;
  end if;
  return new;
end $$;
create trigger guard_habit before insert or update on habit_mobile.habits for each row execute function habit_mobile.guard_habit();

create function habit_mobile.guard_checkin() returns trigger
language plpgsql security invoker set search_path='' as $$
declare h habit_mobile.habits%rowtype; uid uuid; hid text; day date;
begin
  if tg_op='DELETE' then uid:=old.user_id; hid:=old.habit_id; day:=old.date;
  else uid:=new.user_id; hid:=new.habit_id; day:=new.date; new.created_at:=clock_timestamp(); end if;
  if auth.uid() is null or uid<>auth.uid() then raise exception using errcode='42501',message='authentication_required'; end if;
  select * into h from habit_mobile.habits where user_id=auth.uid() and id=hid for update;
  if h.id is null then raise exception 'habit_not_found'; end if;
  if h.archived_on is not null then raise exception 'habit_archived'; end if;
  if day is null or day<h.created_date or day>(clock_timestamp() at time zone 'Asia/Shanghai')::date then raise exception 'date_not_eligible'; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger guard_checkin before insert or delete on habit_mobile.habit_checkins for each row execute function habit_mobile.guard_checkin();

create function habit_mobile.create_habit(p_id text,p_name text,p_color integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare h habit_mobile.habits%rowtype; begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  insert into habit_mobile.habits(id,name,color) values(p_id,btrim(p_name),p_color) on conflict(user_id,id) do nothing;
  select * into h from habit_mobile.habits where user_id=auth.uid() and id=p_id;
  if h.name is distinct from btrim(p_name) or h.color is distinct from p_color or h.archived_on is not null then raise exception 'id_already_used'; end if;
  return to_jsonb(h);
end $$;
create function habit_mobile.edit_habit(p_id text,p_name text,p_color integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare h habit_mobile.habits%rowtype; begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  update habit_mobile.habits set name=btrim(p_name),color=p_color where user_id=auth.uid() and id=p_id returning * into h;
  if h.id is null then raise exception 'habit_not_found'; end if;
  return to_jsonb(h);
end $$;
create function habit_mobile.archive_habit(p_id text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare h habit_mobile.habits%rowtype; begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select * into h from habit_mobile.habits where user_id=auth.uid() and id=p_id for update;
  if h.id is null then raise exception 'habit_not_found'; end if;
  if h.archived_on is null then
    update habit_mobile.habits set archived_on=(clock_timestamp() at time zone 'Asia/Shanghai')::date where user_id=auth.uid() and id=p_id returning * into h;
  end if;
  -- Keep every existing checkin, including the archive day's completion.
  return to_jsonb(h);
end $$;
create function habit_mobile.set_checkin(p_habit_id text,p_date date,p_completed boolean) returns void
language plpgsql security invoker set search_path='' as $$
declare h habit_mobile.habits%rowtype; begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_completed is null then raise exception 'completed_required'; end if;
  select * into h from habit_mobile.habits where user_id=auth.uid() and id=p_habit_id for update;
  if h.id is null then raise exception 'habit_not_found'; end if;
  if h.archived_on is not null then raise exception 'habit_archived'; end if;
  if p_date is null or p_date<h.created_date or p_date>(clock_timestamp() at time zone 'Asia/Shanghai')::date then raise exception 'date_not_eligible'; end if;
  if p_completed then
    insert into habit_mobile.habit_checkins(habit_id,date) values(p_habit_id,p_date) on conflict(user_id,habit_id,date) do nothing;
  else delete from habit_mobile.habit_checkins where user_id=auth.uid() and habit_id=p_habit_id and date=p_date;
  end if;
end $$;
-- One SQL statement sees both collections at the same snapshot, without cursors.
-- STABLE means SELECT only; the client sends a POST RPC request.
create function habit_mobile.read_snapshot() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select jsonb_build_object(
    'today',(statement_timestamp() at time zone 'Asia/Shanghai')::date,
    'habits',(select coalesce(jsonb_agg(to_jsonb(h) order by created_at,id),'[]'::jsonb) from habit_mobile.habits h where user_id=auth.uid()),
    'checkins',(select coalesce(jsonb_agg(to_jsonb(c) order by habit_id,date),'[]'::jsonb) from habit_mobile.habit_checkins c where user_id=auth.uid())
  ) into result;
  return result;
end $$;

revoke all on all tables in schema habit_mobile from public,anon,authenticated;
grant select on habit_mobile.habits,habit_mobile.habit_checkins to authenticated;
grant insert(id,name,color) on habit_mobile.habits to authenticated;
grant update(name,color,archived_on) on habit_mobile.habits to authenticated;
grant insert(habit_id,date),delete on habit_mobile.habit_checkins to authenticated;
revoke all on all functions in schema habit_mobile from public,anon,authenticated;
grant execute on function habit_mobile.create_habit(text,text,integer),habit_mobile.edit_habit(text,text,integer),habit_mobile.archive_habit(text),habit_mobile.set_checkin(text,date,boolean),habit_mobile.read_snapshot() to authenticated;
notify pgrst,'reload schema';
commit;
