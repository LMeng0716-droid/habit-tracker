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
psql(auth("SELECT habit_mobile.create_habit('shared','阅读',0);"))
today = psql("SELECT (clock_timestamp() at time zone 'Asia/Shanghai')::date;").stdout.strip()
complete = f"SELECT habit_mobile.set_checkin('shared','{today}',true);"
cancel = f"SELECT habit_mobile.set_checkin('shared','{today}',false);"
follower = overlap(complete, complete)
assert follower.returncode == 0, follower.stderr
snapshot = json.loads(psql(auth('SELECT habit_mobile.read_snapshot();')).stdout.strip().splitlines()[-1])
assert len(snapshot['checkins']) == 1
follower = overlap(cancel, cancel)
assert follower.returncode == 0, follower.stderr
snapshot = json.loads(psql(auth('SELECT habit_mobile.read_snapshot();')).stdout.strip().splitlines()[-1])
assert not snapshot['checkins']
follower = overlap(complete, "SELECT habit_mobile.archive_habit('shared');")
assert follower.returncode == 0, follower.stderr
snapshot = json.loads(psql(auth('SELECT habit_mobile.read_snapshot();')).stdout.strip().splitlines()[-1])
assert snapshot['habits'][0]['archived_on'] == today and len(snapshot['checkins']) == 1
assert psql(auth(cancel), check=False).returncode != 0
psql(auth("SELECT habit_mobile.create_habit('second','运动',1);"))
follower = overlap("SELECT habit_mobile.archive_habit('second');", f"SELECT habit_mobile.set_checkin('second','{today}',true);")
assert follower.returncode != 0 and 'habit_archived' in follower.stderr
print('PASS 4 overlapping sessions: duplicate completion, duplicate cancel, checkin then archive, archive then checkin')

# Repeated installation refuses existing objects and preserves committed data.
from pathlib import Path
migration = (Path(__file__).resolve().parents[1] / 'migrations/202610110001_mobile_cloud.sql').read_text()
counts = "SELECT json_build_array((SELECT count(*) FROM habit_mobile.habits),(SELECT count(*) FROM habit_mobile.habit_checkins),(SELECT count(*) FROM pg_namespace WHERE nspname IN ('habit_api','habit_private')));"
before = psql(counts).stdout
retry = psql('SET ROLE managed_migration_admin;\n' + migration, check=False)
assert retry.returncode != 0 and 'schema "habit_mobile" already exists' in retry.stderr
assert psql(counts).stdout == before
print('PASS repeated migration refuses existing schema without changing any data')
