-- Read-only preflight as actual migration administrator in an isolated Supabase
-- test project. Does not test JWTs, create roles, grant rights or execute RPCs.
select current_user as migration_role, current_setting('server_version') as postgres_version,
       current_setting('server_version_num')::integer >= 150000 as supported_version;
select rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolcanlogin, rolinherit
from pg_roles where rolname in (current_user,'anon','authenticated','habit_rpc_owner');
select to_regclass('auth.users') as auth_users, to_regprocedure('auth.uid()') as auth_uid;
-- False grant options do NOT prevent the fallback, but prohibit direct grants.
select has_database_privilege(current_user,current_database(),'CREATE') as can_create_schema,
       has_schema_privilege(current_user,'auth','USAGE WITH GRANT OPTION') as can_grant_auth_usage,
       has_function_privilege(current_user,'auth.uid()','EXECUTE WITH GRANT OPTION') as can_grant_auth_uid,
       has_table_privilege(current_user,'auth.users','REFERENCES') as can_reference_auth_users;
select exists(select 1 from pg_namespace n, lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
  where n.nspname='auth' and a.grantee=0 and a.privilege_type='USAGE') as public_auth_usage;
select has_schema_privilege('authenticated','auth','USAGE') as authenticated_auth_usage,
       has_function_privilege('authenticated','auth.uid()','EXECUTE') as authenticated_auth_uid;
-- Review existing authenticated privileges in other application schemas too.
select nspname from pg_namespace where has_schema_privilege('authenticated',oid,'CREATE');
-- PG16+ fallback needs ADMIN on authenticated; CREATEROLE alone is insufficient.
-- Catalog output is evidence, not proof of every managed-platform restriction.
select pg_get_userbyid(roleid) as granted_role, pg_get_userbyid(member) as member_role, admin_option
from pg_auth_members where roleid='authenticated'::regrole or member='authenticated'::regrole;
select nspname, pg_get_userbyid(nspowner) as schema_owner
from pg_namespace where nspname in ('habit_api','habit_private');
select p.oid::regprocedure as signature, pg_get_userbyid(p.proowner) as function_owner,
       p.prosecdef as security_definer, p.proconfig
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('habit_api','habit_private');
-- After successful 002: auth privileges true, clients not members of API owner,
-- owner not member of any high-privilege role, no persistent schema CREATE.
select r.rolname, has_schema_privilege(r.oid,'auth','USAGE') as auth_usage,
       has_function_privilege(r.oid,'auth.uid()','EXECUTE') as auth_uid_execute,
       pg_has_role('authenticated',r.oid,'MEMBER') as client_can_set_owner
from pg_roles r where r.rolname='habit_rpc_owner';
-- Missing Auth objects should produce errors; never replace real Auth with stubs.
