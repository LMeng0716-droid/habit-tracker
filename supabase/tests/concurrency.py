"""Real overlapping sessions in the NEW local test container supplied by run-local.sh.
No network database URL/password is accepted; production cannot be targeted here.
"""
import json
import subprocess
import sys

container = sys.argv[1]
uid = "00000000-0000-0000-0000-000000000003"


def psql(sql, check=True):
    return subprocess.run(
        ["docker", "exec", "-i", container, "psql", "-U", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
        input=sql, text=True, capture_output=True, check=check,
    )


def auth(sql):
    return "SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','" + uid + "',false);\n" + sql


def operation(n, version, name):
    op = [{"operation_id": f"00000000-0000-0000-0003-{n:012d}", "type": "habit_update", "expected_version": str(version), "data": {"id": "shared-habit", "name": name, "color": 0, "category_id": None}}]
    return "SELECT habit_api.apply_operations('" + json.dumps(op) + "'::jsonb);"


def overlap(write_sql, follower_sql):
    writer = subprocess.Popen(
        ["docker", "exec", "-i", container, "psql", "-U", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    try:
        writer.stdin.write(auth("BEGIN;\n" + write_sql + "\nSELECT 'LOCK_HELD'; SELECT pg_sleep(2); COMMIT;\n"))
        writer.stdin.close()
        lines = []
        while True:
            line = writer.stdout.readline()
            lines.append(line)
            if line.strip() == "LOCK_HELD":
                break
            if not line:
                raise AssertionError("writer failed before lock marker: " + writer.stderr.read())
        follower = psql(auth(follower_sql), check=False)
        writer.wait(timeout=15)
        assert writer.returncode == 0, writer.stderr.read()
        return follower
    finally:
        if writer.poll() is None:
            writer.kill()
            writer.wait()


psql(f"INSERT INTO auth.users(id) VALUES ('{uid}');")
psql(auth("SELECT habit_api.bootstrap_user('00000000-0000-0000-0003-000000000001','UTC');"))
create = [{"operation_id": "00000000-0000-0000-0003-000000000002", "type": "habit_create", "expected_version": "0", "data": {"id": "shared-habit", "name": "initial", "color": 0, "category_id": None, "created_date": "1900-01-01", "created_at_ms": 1, "plan_id": "initial:shared-habit", "schedule": {"kind": "daily"}, "order_version": "1"}}]
psql(auth("SELECT habit_api.apply_operations('" + json.dumps(create) + "'::jsonb);"))

# Two simultaneous edits from version 1: exactly one commits.
follower = overlap(operation(3, 1, "winner"), operation(4, 1, "loser"))
assert follower.returncode != 0 and "version_conflict" in follower.stderr, follower
snapshot = json.loads(psql(auth("SELECT habit_api.full_snapshot();")).stdout.strip().splitlines()[-1])
assert snapshot["habits"][0]["version"] == "2" and snapshot["habits"][0]["name"] == "winner"
assert snapshot["cursor"] == "12"
assert psql("SELECT count(*) FROM habit_private.operation_receipts WHERE operation_id='00000000-0000-0000-0003-000000000004';").stdout.strip() == "0"

# Simultaneous same-ID retry waits for the original transaction, then uses receipt.
follower = overlap(operation(5, 2, "once"), operation(5, 2, "once"))
assert follower.returncode == 0, follower.stderr
snapshot = json.loads(psql(auth("SELECT habit_api.full_snapshot();")).stdout.strip().splitlines()[-1])
assert snapshot["cursor"] == "13" and snapshot["habits"][0]["version"] == "3"

# Snapshot waits behind an uncommitted write, returning matching data + watermark.
follower = overlap(operation(6, 3, "snapshot-consistent"), "SELECT habit_api.full_snapshot();")
assert follower.returncode == 0, follower.stderr
snapshot = json.loads(follower.stdout.strip().splitlines()[-1])
assert snapshot["cursor"] == "14" and snapshot["habits"][0]["version"] == "4"
assert snapshot["habits"][0]["name"] == "snapshot-consistent"
print("PASS 3 overlapping-session scenarios: CAS winner, idempotent retry, snapshot consistency")
