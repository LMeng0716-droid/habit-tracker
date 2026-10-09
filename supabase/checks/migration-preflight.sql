-- Read-only. Run as the intended migration administrator in an ISOLATED
-- Supabase test project before 001/002. This does not grant any permission.
select current_user as migration_role, current_setting('server_version') as postgres_version,
       current_setting('server_version_num')::integer >= 150000 as supported_version;
select rolname, rolsuper, rolcreaterole, rolbypassrls, rolcanlogin
from pg_roles where rolname in (current_user,'anon','authenticated','habit_rpc_owner');
select to_regclass('auth.users') as auth_users, to_regprocedure('auth.uid()') as auth_uid;
-- All four should be true; existing habit schemas must be owned by the
-- migration administrator (or a role it may act as). Missing auth objects
-- cause these queries to fail: do not substitute local Auth stubs.
select has_database_privilege(current_user,current_database(),'CREATE') as can_create_schema,
       has_schema_privilege(current_user,'auth','USAGE WITH GRANT OPTION') as can_grant_auth_usage,
       has_function_privilege(current_user,'auth.uid()','EXECUTE WITH GRANT OPTION') as can_grant_auth_uid,
       has_table_privilege(current_user,'auth.users','REFERENCES') as can_reference_auth_users;
select nspname, pg_get_userbyid(nspowner) as schema_owner
from pg_namespace where nspname in ('habit_api','habit_private');
select p.oid::regprocedure as signature, pg_get_userbyid(p.proowner) as function_owner,
       p.prosecdef as security_definer, p.proconfig
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('habit_api','habit_private');
-- This cannot prove platform policies permit CREATE ROLE / ALTER OWNER.
-- Applying 001 then 002 transactionally in the disposable project is required.
