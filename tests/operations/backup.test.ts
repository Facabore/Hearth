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
});
