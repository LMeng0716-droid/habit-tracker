"""Disposable-container-only verification of entire installation rollback."""
import subprocess
import sys
from pathlib import Path

container = sys.argv[1]
label = subprocess.run(['docker', 'inspect', '--format', '{{ index .Config.Labels "habit-tracker.disposable-audit" }}', container], text=True, capture_output=True, check=True).stdout.strip()
if label != 'true':
    raise SystemExit('Refusing non-disposable container')


def sql(query, check=True):
    return subprocess.run(['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=query, text=True, capture_output=True, check=check)


migration = (Path(__file__).resolve().parents[1] / 'migrations/202610110001_mobile_cloud.sql').read_text()
# Fault occurs after tables/functions/policies/grants have all been installed.
fault = migration.replace("notify pgrst,'reload schema';", "select 1/0;")
result = sql('SET ROLE managed_migration_admin;\n' + fault, False)
assert result.returncode != 0 and 'division by zero' in result.stderr, result.stderr
assert sql("SELECT count(*) FROM pg_namespace WHERE nspname='habit_mobile';").stdout.strip() == '0'
assert sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='habit_mobile';").stdout.strip() == '0'
# Also check failure early during FK installation, then restore only local fixture.
sql('REVOKE REFERENCES ON auth.users FROM managed_migration_admin;')
result = sql('SET ROLE managed_migration_admin;\n' + migration, False)
assert result.returncode != 0 and 'permission denied for table users' in result.stderr, result.stderr
assert sql("SELECT count(*) FROM pg_namespace WHERE nspname='habit_mobile';").stdout.strip() == '0'
sql('GRANT REFERENCES ON auth.users TO managed_migration_admin;')
print('PASS full migration rollback: late injected fault and missing Auth FK privilege; no schema remains')
