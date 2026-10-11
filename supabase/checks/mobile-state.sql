-- READ ONLY: run in habit-tracker-test SQL Editor, never paste test fixtures.
-- No RPC calls, CREATE, GRANT, DELETE, ALTER, DROP or remote connections.
select current_user, current_setting('server_version');
select rolname,rolsuper,rolbypassrls,rolcanlogin from pg_roles
where rolname in ('anon','authenticated');
select to_regnamespace('habit_api') as old_api,
       to_regnamespace('habit_private') as old_private,
       to_regnamespace('habit_mobile') as mobile,
       to_regclass('supabase_migrations.schema_migrations') as cli_history;
select has_database_privilege(current_user,current_database(),'CREATE') as can_create_schema,
       has_table_privilege(current_user,'auth.users','REFERENCES') as can_reference_auth_users,
       has_schema_privilege('authenticated','auth','USAGE') as client_auth_usage,
       has_function_privilege('authenticated','auth.uid()','EXECUTE') as client_auth_uid;
-- This installation requires no custom role / Auth GRANT OPTION.
select n.nspname,c.relname,pg_get_userbyid(c.relowner) as owner,
       c.relrowsecurity,c.relforcerowsecurity,c.relacl
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('habit_api','habit_private','habit_mobile') and c.relkind in ('r','p') order by 1,2;
select table_schema,table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns where table_schema in ('habit_api','habit_private','habit_mobile')
order by table_schema,table_name,ordinal_position;
select n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid) as definition
from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('habit_api','habit_private','habit_mobile');
select * from pg_policies where schemaname in ('habit_api','habit_private','habit_mobile');
select p.oid::regprocedure as signature,pg_get_userbyid(p.proowner) as owner,p.prosecdef,p.proconfig,p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('habit_api','habit_private','habit_mobile');
select n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('habit_api','habit_private','habit_mobile') and not t.tgisinternal;
-- OUTPUT exact-count SELECT statements for the reviewer to run individually.
-- This query does not execute them and does not reveal any habit contents.
select format('select %L as table_name,count(*) from %I.%I;',n.nspname||'.'||c.relname,n.nspname,c.relname) as read_only_count_sql
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('habit_api','habit_private','habit_mobile') and c.relkind='r';
-- Run after successful mobile installation: expected RLS true/true;
-- 5 application RPCs and 2 trigger functions, all SECURITY INVOKER.
select p.oid::regprocedure,has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as client_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='habit_mobile';
