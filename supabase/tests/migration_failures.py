"""Failure/rollback tests in the disposable managed-profile container only."""
import subprocess
import sys
from pathlib import Path

container = sys.argv[1]
label = subprocess.run(['docker', 'inspect', '--format', '{{ index .Config.Labels "habit-tracker.disposable-audit" }}', container], capture_output=True, text=True, check=True).stdout.strip()
if label != 'true':
    raise SystemExit('Refusing non-disposable database container')


def sql(query, check=True):
    return subprocess.run(['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=query, capture_output=True, text=True, check=check)


migration = (Path(__file__).resolve().parents[1] / 'migrations/202610090002_sync_api.sql').read_text()


def rejected(message):
    result = sql('SET ROLE managed_migration_admin;\n' + migration, False)
    assert result.returncode != 0 and message in result.stderr, result.stderr
    assert sql("SELECT count(*) FROM pg_roles WHERE rolname='habit_rpc_owner';").stdout.strip() == '0'
    assert sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='habit_private' AND table_name='sync_heads' AND column_name='retained_after';").stdout.strip() == '0'
    assert sql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('habit_api','habit_private');").stdout.strip() == '0'


# Reproduce the original migration: GRANT can merely warn and grant nothing.
# Keep everything in its transaction and force a real RPC before any COMMIT.
start = migration.index('grant usage on schema habit_api, habit_private to habit_rpc_owner;')
end = migration.index('grant select,insert,update on habit_api.user_profiles', start)
legacy = migration[:start] + "grant usage on schema auth, habit_api, habit_private to habit_rpc_owner;\ngrant execute on function auth.uid() to habit_rpc_owner;\n" + migration[end:]
legacy = legacy.rsplit('commit;', 1)[0] + "SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',false); SELECT habit_api.bootstrap_user('00000000-0000-0000-0000-000000000099'); ROLLBACK;"
result = sql('SET ROLE managed_migration_admin;\n' + legacy, False)
assert result.returncode != 0 and 'permission denied for schema auth' in result.stderr, result.stderr
assert sql("SELECT count(*) FROM pg_roles WHERE rolname='habit_rpc_owner';").stdout.strip() == '0'
print('PASS original Auth GRANT failure reproduced: RPC denied, no objects committed')

# Authentication role graph drift is refused before anything commits.
sql('CREATE ROLE unsafe_parent NOLOGIN; GRANT unsafe_parent TO authenticated;')
rejected('unsafe_authenticated_role_graph')
sql('REVOKE unsafe_parent FROM authenticated; DROP ROLE unsafe_parent;')
# No permission to use Auth: fail rather than install unusable definers.
sql('REVOKE USAGE ON SCHEMA auth FROM authenticated;')
rejected('rpc_owner_auth_access_required')
sql('GRANT USAGE ON SCHEMA auth TO authenticated;')
# PG16+ requires ADMIN on the role being granted, independently of CREATEROLE.
if int(sql("SELECT current_setting('server_version_num');").stdout.strip()) >= 160000:
    sql('REVOKE ADMIN OPTION FOR authenticated FROM managed_migration_admin;')
    rejected('permission denied to grant role')
    sql('GRANT authenticated TO managed_migration_admin WITH ADMIN OPTION;')
print('PASS managed Auth permission failure paths and complete migration rollback')
