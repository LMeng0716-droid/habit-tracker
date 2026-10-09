"""Real overlapping sessions in the NEW local test container supplied by run-local.sh.
No network database URL/password is accepted; production cannot be targeted here.
"""
import json
import subprocess
import sys

container = sys.argv[1]
# Refuse accidental use against an existing/unlabelled database container.
label = subprocess.run(
    ["docker", "inspect", "--format", '{{ index .Config.Labels "habit-tracker.disposable-audit" }}', container],
    text=True, capture_output=True, check=True,
).stdout.strip()
if label != "true":
    raise SystemExit("Refusing non-disposable database container")
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
    global writer_output
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
        writer_output = lines
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

# Reader holds SHARE until commit; following writer cannot contaminate its snapshot.
follower = overlap("SELECT habit_api.full_snapshot();", operation(7, 4, "after-reader"))
assert follower.returncode == 0, follower.stderr
reader_snapshot = json.loads(writer_output[-2])
assert reader_snapshot["cursor"] == "14" and reader_snapshot["habits"][0]["version"] == "4"
snapshot = json.loads(psql(auth("SELECT habit_api.full_snapshot();")).stdout.strip().splitlines()[-1])
assert snapshot["cursor"] == "15" and snapshot["habits"][0]["version"] == "5"

# Delta read behind writer: watermark and after-image include the same commit.
follower = overlap(operation(8, 5, "delta-consistent"), "SELECT habit_api.pull_changes('15',null,1);")
assert follower.returncode == 0, follower.stderr
page = json.loads(follower.stdout.strip().splitlines()[-1])
assert page["high_water"] == page["next_cursor"] == "16"
assert not page["has_more"] and len(page["events"]) == 1
assert page["events"][0]["payload"]["name"] == "delta-consistent"

# Same first-bootstrap retry must serialize even before a head row exists.
uid = "00000000-0000-0000-0000-000000000004"
psql(f"INSERT INTO auth.users(id) VALUES ('{uid}');")
bootstrap = "SELECT habit_api.bootstrap_user('00000000-0000-0000-0004-000000000001','UTC');"
follower = overlap(bootstrap, bootstrap)
assert follower.returncode == 0, follower.stderr
snapshot = json.loads(psql(auth("SELECT habit_api.full_snapshot();")).stdout.strip().splitlines()[-1])
assert snapshot["cursor"] == "8" and len(snapshot["categories"]) == 6
print("PASS 3 additional overlapping-session scenarios: reader first, delta consistency, first bootstrap retry")
