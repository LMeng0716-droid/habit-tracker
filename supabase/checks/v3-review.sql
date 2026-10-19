-- READ ONLY. Safe before or after the proposed extension. No RPCs or DDL.
select current_user,current_setting('server_version') as server_version;
select to_regnamespace('habit_mobile') as mobile_schema,
       to_regclass('habit_mobile.progress_operations') as progress_journal,
       to_regclass('habit_mobile.habit_daily_progress') as progress_view;
select has_schema_privilege('authenticated','auth','USAGE') as auth_usage,
       has_function_privilege('authenticated','auth.uid()','EXECUTE') as uid_execute,
       has_function_privilege('authenticated','pg_catalog.pg_advisory_xact_lock(bigint)','EXECUTE') as advisory_execute;
select n.nspname,c.relname,pg_get_userbyid(c.relowner) as owner,c.relrowsecurity,c.relforcerowsecurity,c.reloptions,c.relacl
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='habit_mobile' and c.relkind in ('r','v') order by c.relname;
select column_name,data_type,is_nullable,column_default from information_schema.columns
where table_schema='habit_mobile' and table_name in ('habits','habit_checkins','progress_operations') order by table_name,ordinal_position;
select c.relname,k.conname,pg_get_constraintdef(k.oid) definition from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='habit_mobile';
select * from pg_policies where schemaname='habit_mobile';
select p.oid::regprocedure signature,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.proconfig,
       has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='habit_mobile' order by p.proname;
select table_name,column_name,privilege_type,grantee from information_schema.column_privileges
where table_schema='habit_mobile' and grantee in ('authenticated','anon','PUBLIC') order by table_name,column_name,grantee;
select c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='habit_mobile' and not t.tgisinternal;
-- Review the emitted statements separately. Never exposes habit text/amounts.
select format('select %L as relation,count(*) from %I.%I;',n.nspname||'.'||c.relname,n.nspname,c.relname) read_only_count_sql
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='habit_mobile' and c.relkind='r';
-- Exposed tables/functions are project Data API settings, not proven by grants.
-- Read this result in combination with Dashboard's selected object exposure.
select current_setting('pgrst.db_schemas',true) as postgrest_schema_setting_if_visible;

-- Old add/set draft is incompatible with the event revision draft: stop if present.
select column_name,data_type from information_schema.columns
where table_schema='habit_mobile' and table_name='progress_operations'
 and column_name in ('value_after','event_id','event_kind','occurred_at');
select indexname,indexdef from pg_indexes where schemaname='habit_mobile';
-- Catalog only: do not call write RPCs to probe permissions.
select p.oid::regprocedure signature,
 has_function_privilege('anon',p.oid,'EXECUTE') anonymous_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') client_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='habit_mobile' and p.proname in ('record_progress_v3','record_events_v3','read_events_v3');
