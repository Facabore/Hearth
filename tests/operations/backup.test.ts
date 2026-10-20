import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bogotaToday,
  logEvents,
  seedLedger,
  startBackupStack,
  todayIn,
  type BackupStack,
} from "../support/backup-stack";

describe("nightly backup (HU-E8-01)", () => {
  let stack: BackupStack;
  beforeAll(async () => {
    stack = await startBackupStack();
    await seedLedger(stack, { live: 3, deleted: 1 });
  });
  afterAll(() => stack?.stop());

  it("writes hearth-<Bogota date>.sql.gz recording the 4 transactions of its own snapshot, the deleted one included", () => {
    const days = [bogotaToday()];
    const result = stack.run("sh /hearth/backup.sh");
    days.push(bogotaToday());
    expect(result.status).toBe(0);
    const events = logEvents(result.stdout);
    expect(events).toEqual([
      expect.objectContaining({
        level: "info",
        event: "backup_written",
        job: "nightly-backup",
        transactions: 4,
      }),
    ]);
    const file = String(events[0]!.file);
    expect(days.map((day) => `hearth-${day}.sql.gz`)).toContain(file);
    expect(stack.backups()).toEqual([file]);
    const dump = stack.run(`gunzip -c /backups/${file} | sed -n '1p;/^COPY public.transactions /p'`);
    expect(dump.stdout).toMatch(/^-- hearth-backup transactions=4\nCOPY public\.transactions \(/);
    // The header describes the file's own rows: one per line of the COPY block, up to its terminating `\.`.
    const rows = stack.run(
      String.raw`gunzip -c /backups/${file} | awk '/^COPY public.transactions /{f=1;next} $0=="\\."{f=0} f' | wc -l`,
    );
    expect(Number(rows.stdout)).toBe(4);
  });

  it("names the file with the date in the container's TZ, not UTC's", () => {
    // A zone whose date differs from UTC's now, with at least an hour of margin either way.
    const tz = new Date().getUTCHours() < 11 ? "Etc/GMT+12" : "Pacific/Kiritimati";
    const days = [todayIn(tz)];
    expect(days[0]).not.toBe(todayIn("UTC"));
    const result = stack.run("sh /hearth/backup.sh", { env: { TZ: tz } });
    days.push(todayIn(tz));
    expect(result.status).toBe(0);
    expect(days.map((day) => `hearth-${day}.sql.gz`)).toContain(String(logEvents(result.stdout)[0]!.file));
  });

  it("exits 1 and logs backup_failed for nightly-backup when the database is unreachable, keeping every backup", () => {
    const before = stack.backups();
    const result = stack.run("sh /hearth/backup.sh", { env: { PGHOST: "db-down" } });
    expect(result.status).toBe(1);
    expect(logEvents(result.stdout)).toEqual([
      expect.objectContaining({
        level: "error",
        event: "backup_failed",
        job: "nightly-backup",
        reason: "DumpFailed",
      }),
    ]);
    expect(stack.backups()).toEqual(before);
  });

  it("keeps no file when pg_dump cannot finish, such as for a role that may read only transactions", async () => {
    await stack.pool.query("CREATE ROLE reader LOGIN PASSWORD 'reader'");
    await stack.pool.query("GRANT SELECT ON transactions TO reader");
    const before = stack.backups();
    const result = stack.run("sh /hearth/backup.sh", { env: { PGUSER: "reader", PGPASSWORD: "reader" } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("permission denied");
    expect(logEvents(result.stdout)).toEqual([
      expect.objectContaining({ event: "backup_failed", reason: "DumpFailed" }),
    ]);
    expect(stack.backups()).toEqual(before);
    expect(stack.run(`gunzip -c /backups/${before[0]} | head -n 1`).stdout).toBe(
      "-- hearth-backup transactions=4\n",
    );
  });

  it("gives pg_dump, and the session that counts before it, 300 s to get a table lock instead of waiting for ever", () => {
    // A pg_dump in front of the real one records what it is called with and what the environment holds.
    const wrapper = String.raw`#!/bin/sh
echo "$PGOPTIONS" > /tmp/pg_dump.env
echo "$*" > /tmp/pg_dump.args
exec REAL "$@"`;
    const result = stack.run(
      [
        "mkdir /tmp/bin",
        `cat > /tmp/bin/pg_dump <<'WRAPPER'\n${wrapper}\nWRAPPER`,
        'sed -i "s#REAL#$(command -v pg_dump)#" /tmp/bin/pg_dump',
        "chmod +x /tmp/bin/pg_dump",
        "PATH=/tmp/bin:$PATH sh /hearth/backup.sh > /dev/null",
        "status=$?",
        "cat /tmp/pg_dump.args /tmp/pg_dump.env",
        "exit $status",
      ].join("\n"),
    );
    expect(result.status).toBe(0);
    const [args, env] = result.stdout.split("\n");
    expect(args).toContain("--lock-wait-timeout=300s");
    expect(env).toContain("-c lock_timeout=300s");
  });

  it("exits 1 with Interrupted when a signal reaches it while pg_dump waits for a lock, keeping no file", async () => {
    const before = stack.backups();
    // Another session holds a table pg_dump needs, so the dump stays blocked for as long as the test wants.
    const locker = await stack.pool.connect();
    try {
      await locker.query("BEGIN");
      await locker.query("LOCK TABLE idempotency_keys IN ACCESS EXCLUSIVE MODE");
      const started = Date.now();
      const result = stack.run(
        [
          "sh /hearth/backup.sh > /tmp/backup.out 2>&1 &",
          "pid=$!",
          `n=0; until [ "$(psql -X -Atc "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'LOCK TABLE%'")" = 1 ]; do n=$((n+1)); [ $n -lt 60 ] || exit 3; sleep 1; done`,
          "kill -TERM $pid",
          "wait $pid",
          'echo "status=$?"',
          // The dump's own processes go with the script: the signal reaches the whole group psql started.
          "sleep 1",
          'echo "left=$(pgrep -x pg_dump | wc -l)$(pgrep -x gzip | wc -l)$(pgrep -x psql | wc -l)"',
          "cat /tmp/backup.out",
        ].join("\n"),
      );
      // A signal handled only after the blocked dump ended would take the full lock wait.
      expect(Date.now() - started).toBeLessThan(60_000);
      expect(result.stdout).toContain("status=1");
      expect(result.stdout).toContain("left=000\n");
      expect(logEvents(result.stdout)).toEqual([
        expect.objectContaining({
          level: "error",
          event: "backup_failed",
          job: "nightly-backup",
          reason: "Interrupted",
        }),
      ]);
      expect(stack.backups()).toEqual(before);
    } finally {
      await locker.query("ROLLBACK").catch(() => undefined);
      locker.release();
    }
  });
});
