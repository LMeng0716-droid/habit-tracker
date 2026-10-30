-- READ ONLY. First verify Dashboard project name = habit-tracker-v3-sandbox
-- and its project ref/URL. current_database() alone cannot prove project identity.
-- No credentials, user content, RPC writes, role changes or DDL.
select current_database(), current_user, current_setting('server_version') as version;
select case
 when to_regclass('habit_mobile.habits') is null or to_regclass('habit_mobile.habit_checkins') is null then 'STOP: mobile foundation missing or partial'
 when exists(select 1 from information_schema.columns where table_schema='habit_mobile' and table_name='progress_operations' and column_name='value_after') then 'STOP: obsolete daily-command draft; manual review required'
 when to_regclass('habit_mobile.progress_operations') is not null then 'STOP: V3 installed or partial; do not rerun proposal; inspect catalogs'
 when exists(select 1 from information_schema.columns where table_schema='habit_mobile' and table_name='habits' and column_name='habit_type') then 'STOP: partial V3 columns; manual review required'
 else 'Inspect v3-review.sql and backups before approving foundation-only upgrade'
end as migration_state;
select c.relname,c.relrowsecurity,c.relforcerowsecurity,
 pg_get_userbyid(c.relowner) as owner
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='habit_mobile' and c.relkind='r';
select p.oid::regprocedure as signature,p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') as anonymous_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as client_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='habit_mobile';
-- Continue with v3-review.sql, then v3-data-integrity.sql only if foundation exists.
-- STOP on permission, RLS/FORCE, signature, owner or partial-installation problems.
