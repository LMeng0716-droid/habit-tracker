#!/usr/bin/env bash
# ONLY a disposable local container. Never accepts a remote database URL.
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
image='postgres:17@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3'
test_db_password=$(python3 -c 'import secrets; print(secrets.token_hex(24))')
container_id=$(docker run --detach --label habit-tracker.disposable-audit=true --env POSTGRES_PASSWORD="$test_db_password" "$image")
trap 'docker rm --force "$container_id" >/dev/null' EXIT
ready=false
for attempt in {1..30}; do
  if docker exec "$container_id" sh -c '[ "$(cat /proc/1/comm)" = postgres ] && pg_isready -U postgres' >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then echo 'Local database not ready' >&2; exit 1; fi
docker exec -i "$container_id" psql -U postgres -v ON_ERROR_STOP=1 < "$project_dir/supabase/tests/local-bootstrap.sql"
docker exec -i "$container_id" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
revoke grant option for usage on schema auth from managed_migration_admin;
revoke grant option for execute on function auth.uid() from managed_migration_admin;
create schema habit_api;
create table habit_api.audit_sentinel(id integer primary key);
insert into habit_api.audit_sentinel values(1);
SQL
docker exec -i "$container_id" psql -U postgres -v ON_ERROR_STOP=1 < "$project_dir/supabase/checks/mobile-state.sql"
{ printf 'SET ROLE managed_migration_admin;\n'; cat "$project_dir/supabase/migrations/202610110001_mobile_cloud.sql"; } | docker exec -i "$container_id" psql -U postgres -v ON_ERROR_STOP=1
docker exec -i "$container_id" psql -U postgres -v ON_ERROR_STOP=1 < "$project_dir/supabase/tests/mobile_cloud.sql"
python3 "$project_dir/supabase/tests/mobile_concurrency.py" "$container_id"
docker exec -i "$container_id" psql -U postgres -v ON_ERROR_STOP=1 < "$project_dir/supabase/checks/mobile-state.sql"
