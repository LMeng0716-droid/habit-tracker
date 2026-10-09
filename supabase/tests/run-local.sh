#!/usr/bin/env bash
# Starts ONLY a new isolated local container, exposes no TCP port, removes it on exit.
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
container_name="habit-sync-design-test-$$"
case "${1:-16}" in
  15) image='postgres:15@sha256:c961aa287d8698297cb26cdfadfbe9fd2cbaf77e53cfffe9636e8d8a1e4d842c' ;;
  16) image='postgres:16@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d' ;;
  *) echo 'Only isolated PostgreSQL 15 or 16 tests are supported' >&2; exit 2 ;;
esac
test_db_password=$(python3 -c 'import secrets; print(secrets.token_hex(24))')
container_id=$(docker run --detach --name "$container_name" --label habit-tracker.disposable-audit=true --env POSTGRES_PASSWORD="$test_db_password" "$image")
trap 'docker rm --force "$container_id" >/dev/null' EXIT
ready=false
for attempt in {1..30}; do
  if docker exec "$container_id" sh -c '[ "$(cat /proc/1/comm)" = postgres ] && pg_isready -U postgres' >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then docker logs "$container_id"; exit 1; fi
for sql_file in supabase/tests/local-bootstrap.sql supabase/checks/migration-preflight.sql supabase/migrations/202610090001_sync_foundation.sql supabase/tests/rls_foundation.sql supabase/migrations/202610090002_sync_api.sql supabase/tests/sync_api.sql; do
  if [[ "$sql_file" == supabase/migrations/* || "$sql_file" == supabase/checks/* ]]; then
    { printf 'SET ROLE managed_migration_admin;\n'; cat "$project_dir/$sql_file"; } | docker exec -i "$container_id" psql -U postgres -v ON_ERROR_STOP=1
  else
    docker exec -i "$container_id" psql -U postgres -v ON_ERROR_STOP=1 < "$project_dir/$sql_file"
  fi
done

python3 "$project_dir/supabase/tests/concurrency.py" "$container_id"
