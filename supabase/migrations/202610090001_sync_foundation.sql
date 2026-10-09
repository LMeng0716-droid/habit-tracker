-- Review-only foundation. Apply manually to a disposable Supabase project FIRST.
-- No production connection is made by this repository. No application writes
-- are granted until a separately reviewed atomic RPC migration is implemented.
-- Requires Supabase auth.users/auth.uid(), anon and authenticated roles, PG >=15.
-- Fail on pre-existing names; do not silently redefine existing production data.
begin;
create schema habit_api;
create schema habit_private;
revoke all on schema habit_api, habit_private from public, anon, authenticated;
grant usage on schema habit_api to authenticated;

create table habit_api.user_profiles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  calendar_timezone text not null default 'Asia/Shanghai',
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (length(calendar_timezone) between 1 and 100)
);

-- IDs are opaque text: current IDs include 32 hex chars, preset-N,
-- initial:<habitId>, and JSON-encoded date tuples. Do NOT cast to UUID.
create table habit_api.categories (
  user_id uuid not null references habit_api.user_profiles(user_id) on delete restrict,
  id text not null check (length(id) between 1 and 512),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 30),
  preset boolean not null default false,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (user_id, id)
);
create table habit_api.habits (
  user_id uuid not null references habit_api.user_profiles(user_id) on delete restrict,
  id text not null check (length(id) between 1 and 512),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 30),
  color smallint not null check (color between 0 and 4),
  category_id text,
  created_date date not null check (created_date >= date '1900-01-01'),
  legacy_created_at_ms bigint not null check (legacy_created_at_ms >= 0),
  archived_date date check (archived_date >= created_date),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (user_id, id),
  foreign key (user_id, category_id) references habit_api.categories(user_id, id) on delete restrict
);
create table habit_api.schedule_versions (
  user_id uuid not null,
  id text not null check (length(id) between 1 and 1024),
  habit_id text not null,
  effective_date date not null check (effective_date >= date '1900-01-01'),
  kind text not null check (kind in ('daily', 'weekdays', 'weeklyQuota')),
  -- Weekday bitmask: bit 0=ISO Monday ... bit 6=Sunday. Exactly 1..127.
  weekday_mask smallint,
  weekly_target smallint,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (user_id, id), unique (user_id, habit_id, effective_date),
  foreign key (user_id, habit_id) references habit_api.habits(user_id, id) on delete restrict,
  check ((kind = 'daily' and weekday_mask is null and weekly_target is null)
      or (kind = 'weekdays' and weekday_mask is not null and weekday_mask between 1 and 127 and weekly_target is null)
      or (kind = 'weeklyQuota' and weekday_mask is null and weekly_target is not null and weekly_target between 1 and 7))
);
create table habit_api.completions (
  user_id uuid not null,
  habit_id text not null,
  date date not null check (date >= date '1900-01-01'),
  -- A reversal is completed=false, NOT a physical DELETE.
  completed boolean not null default true,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (user_id, habit_id, date),
  foreign key (user_id, habit_id) references habit_api.habits(user_id, id) on delete restrict
);
create table habit_api.daily_notes (
  user_id uuid not null references habit_api.user_profiles(user_id) on delete restrict,
  id text not null check (length(id) between 1 and 1024),
  habit_id text,
  date date not null check (date >= date '1900-01-01'),
  body text not null check (char_length(body) <= 2000),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (user_id, id),
  foreign key (user_id, habit_id) references habit_api.habits(user_id, id) on delete restrict,
  -- NULL habit_id represents one overall summary per user/date.
  unique nulls not distinct (user_id, habit_id, date)
);
create table habit_api.habit_orders (
  user_id uuid primary key references habit_api.user_profiles(user_id) on delete restrict,
  ordered_habit_ids text[] not null default '{}',
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  check (cardinality(ordered_habit_ids) <= 10000)
);
create table habit_api.import_batches (
  user_id uuid not null references habit_api.user_profiles(user_id) on delete restrict,
  id uuid not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_schema smallint not null check (source_schema in (1,2)),
  status text not null check (status in ('staged','needs_review','committed','cancelled')),
  -- Receipts contain counts and ID mappings, never tokens/passwords/raw notes.
  result_summary jsonb not null default '{}' check (jsonb_typeof(result_summary) = 'object'),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (user_id, id), unique (user_id, source_sha256)
);

-- Private infrastructure. Never add habit_private to Data API exposed schemas.
create table habit_private.sync_heads (
  user_id uuid primary key references habit_api.user_profiles(user_id) on delete restrict,
  last_sequence bigint not null default 0 check (last_sequence >= 0)
);
create table habit_private.change_events (
  user_id uuid not null references habit_api.user_profiles(user_id) on delete restrict,
  sequence bigint not null check (sequence > 0),
  entity_type text not null check (entity_type in ('profile','category','habit','schedule','completion','note','order','import')),
  entity_key jsonb not null,
  entity_version bigint not null check (entity_version > 0),
  -- Immutable after-image or tombstone. No mutable join required for pagination.
  payload jsonb not null,
  operation_id uuid not null,
  committed_at timestamptz not null default now(),
  primary key (user_id, sequence)
);
create table habit_private.operation_receipts (
  user_id uuid not null references habit_api.user_profiles(user_id) on delete restrict,
  operation_id uuid not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);

create index habits_category_lookup on habit_api.habits(user_id, category_id);
create index completion_date_lookup on habit_api.completions(user_id, date);
create index note_date_lookup on habit_api.daily_notes(user_id, date);
-- PK/unique constraints already provide user-prefix indexes on every other table.

-- Exact owner isolation even if future grants change. UPDATE includes both
-- USING (old row) and WITH CHECK (new row): user_id cannot be reassigned.
do $$
declare schema_name text; table_name text;
begin
  for schema_name, table_name in
    select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('habit_api','habit_private') and c.relkind='r'
  loop
    execute format('alter table %I.%I enable row level security', schema_name, table_name);
    execute format('alter table %I.%I force row level security', schema_name, table_name);
    execute format('create policy owner_select on %I.%I for select to authenticated using ((select auth.uid()) = user_id)', schema_name, table_name);
    -- Only business tables get future write policies. NO corresponding write grants.
    if schema_name = 'habit_api' then
      execute format('create policy owner_insert on %I.%I for insert to authenticated with check ((select auth.uid()) = user_id)', schema_name, table_name);
      execute format('create policy owner_update on %I.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', schema_name, table_name);
    end if;
    -- No DELETE policy: sync tombstones must not be bypassed.
  end loop;
end $$;

-- Supabase automatic new-table exposure is NOT assumed. Explicit grants only.
revoke all on all tables in schema habit_api, habit_private from public, anon, authenticated;
grant select on habit_api.user_profiles, habit_api.categories, habit_api.habits,
  habit_api.schedule_versions, habit_api.completions, habit_api.daily_notes,
  habit_api.habit_orders, habit_api.import_batches to authenticated;
-- Not a blanket future-table grant. Follow-up migrations must grant explicitly.
-- Default privileges affect objects created by THIS migration role only.
alter default privileges in schema habit_api revoke all on tables from public, anon, authenticated;
alter default privileges in schema habit_private revoke all on tables from public, anon, authenticated;
-- Per-schema default privilege REVOKE cannot cancel a global default grant
-- (notably PostgreSQL PUBLIC EXECUTE on functions). Every follow-up migration
-- must explicitly REVOKE all on each new function/table in its creation
-- transaction before narrowly granting access. Do not change global defaults
-- for unrelated schemas in this foundation.
-- No sequence grants, function grants, Realtime publication or Auth trigger.
-- Follow-up RPCs must auth.uid() check, lock sync_heads, enforce expected_version,
-- validate domain rules, append events and commit receipts in the SAME transaction.
notify pgrst, 'reload schema';
commit;
