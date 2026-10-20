import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { logEvents, startBackupStack, type BackupStack } from "../support/backup-stack";

/** Twenty daily backups, oldest first, far older than any real run's date. */
const JANUARY = Array.from(
  { length: 20 },
  (_, i) => `hearth-2020-01-${String(i + 1).padStart(2, "0")}.sql.gz`,
);

describe("backup retention (HU-E8-01)", () => {
  let stack: BackupStack;
  const seed = (names: string[]) =>
    expect(stack.run(names.map((name) => `echo old | gzip > /backups/${name}`).join(" && ")).status).toBe(0);
  const backup = (env: Record<string, string> = {}) => {
    const result = stack.run("sh /hearth/backup.sh", { env });
    return { ...result, events: logEvents(result.stdout) };
  };
  const writtenFile = (events: Record<string, unknown>[]) =>
    String(events.find((e) => e.event === "backup_written")!.file);

  beforeAll(async () => {
    stack = await startBackupStack();
  });
  beforeEach(() => {
    stack.run("rm -rf /backups/* /backups/.[!.]*");
  });
  afterAll(() => stack?.stop());

  it("keeps only the 14 most recent backups when 20 days exist and the retention is 14 days, the default", () => {
    seed(JANUARY);
    const result = backup();
    expect(result.status).toBe(0);
    const file = writtenFile(result.events);
    expect(stack.backups()).toEqual([...JANUARY.slice(7), file]);
    expect(result.events.filter((e) => e.event === "backup_pruned").map((e) => e.file)).toEqual(
      JANUARY.slice(0, 7).reverse(),
    );
  });

  it("follows BACKUP_RETENTION_DAYS and never touches files that are not backups", () => {
    seed([...JANUARY.slice(0, 5), "notes.txt", ".hearth-2020-01-06.sql.gz.partial"]);
    const result = backup({ BACKUP_RETENTION_DAYS: "3" });
    expect(result.status).toBe(0);
    expect(stack.backups()).toEqual([
      ".hearth-2020-01-06.sql.gz.partial",
      "hearth-2020-01-04.sql.gz",
      "hearth-2020-01-05.sql.gz",
      writtenFile(result.events),
      "notes.txt",
    ]);
  });

  it("ranks backups by name, not by modification time", () => {
    // Created newest name first, so the file times run opposite to the names: 01-05 is the oldest by time.
    const reversed = JANUARY.slice(0, 5).reverse();
    seed(reversed);
    const touches = reversed.map(
      (name, i) => `touch -t 2021010112${String(i).padStart(2, "0")} /backups/${name}`,
    );
    expect(stack.run(touches.join(" && ")).status).toBe(0);
    const result = backup({ BACKUP_RETENTION_DAYS: "3" });
    expect(result.status).toBe(0);
    // By name the new file and 01-05 and 01-04 stay; by time it would have been 01-01 and 01-02.
    expect(stack.backups()).toEqual([JANUARY[3], JANUARY[4], writtenFile(result.events)]);
    expect(result.events.filter((e) => e.event === "backup_pruned").map((e) => e.file)).toEqual([
      JANUARY[2],
      JANUARY[1],
      JANUARY[0],
    ]);
  });

  it("never prunes the file it just wrote, even when a future-dated backup outranks it", () => {
    seed(["hearth-2099-01-01.sql.gz", ...JANUARY.slice(0, 2)]);
    const result = backup({ BACKUP_RETENTION_DAYS: "1" });
    expect(result.status).toBe(0);
    // Remaining: the future-dated file (the one newest by name) and today's new file; both older ones are pruned.
    expect(stack.backups()).toEqual([writtenFile(result.events), "hearth-2099-01-01.sql.gz"]);
    expect(result.events.filter((e) => e.event === "backup_pruned").map((e) => e.file)).toEqual([
      JANUARY[1],
      JANUARY[0],
    ]);
  });

  it("matches whole backup names only, so look-alikes and per-run partials are never pruned", () => {
    const foreign = [
      ".hearth-2020-01-02.sql.gz.4242.partial",
      "hearth-2020-01-02.sql.gz.old",
      "old-hearth-2020-01-02.sql.gz",
      "hearth-2020-1-2.sql.gz",
    ];
    seed([...JANUARY.slice(0, 3), ...foreign]);
    const result = backup({ BACKUP_RETENTION_DAYS: "1" });
    expect(result.status).toBe(0);
    expect(result.events.filter((e) => e.event === "backup_pruned").map((e) => e.file)).toEqual(
      JANUARY.slice(0, 3).reverse(),
    );
    expect(stack.backups()).toEqual([...foreign, writtenFile(result.events)].sort());
  });

  it("prunes nothing while fewer backups than the retention exist", () => {
    seed(JANUARY.slice(0, 2));
    const result = backup();
    expect(stack.backups()).toEqual([...JANUARY.slice(0, 2), writtenFile(result.events)]);
    expect(result.events.map((e) => e.event)).toEqual(["backup_written"]);
  });

  it("prunes nothing when the dump fails", () => {
    seed(JANUARY);
    expect(backup({ PGHOST: "db-down" }).status).toBe(1);
    expect(stack.backups()).toEqual(JANUARY);
  });

  it("exits 1 with PruneFailed when an old backup cannot be deleted, after keeping the new one", () => {
    seed(JANUARY.slice(1, 5));
    // A directory named like a backup makes `rm -f` fail, even as root.
    expect(stack.run(`mkdir /backups/${JANUARY[0]}`).status).toBe(0);
    const result = backup({ BACKUP_RETENTION_DAYS: "3" });
    expect(result.status).toBe(1);
    expect(result.events.map((e) => e.event)).toEqual([
      "backup_written",
      "backup_pruned",
      "backup_pruned",
      "backup_failed",
    ]);
    expect(result.events.at(-1)).toEqual(expect.objectContaining({ reason: "PruneFailed" }));
  });

  it.each(["0", "014", "-3", "two weeks", "10000", "18446744073709551620"])(
    "refuses BACKUP_RETENTION_DAYS=%j before dumping",
    (value) => {
      seed(JANUARY.slice(0, 1));
      const result = backup({ BACKUP_RETENTION_DAYS: value });
      expect(result.status).toBe(1);
      expect(result.events).toEqual([
        expect.objectContaining({
          level: "error",
          event: "backup_failed",
          job: "nightly-backup",
          reason: "InvalidRetention",
        }),
      ]);
      expect(stack.backups()).toEqual(JANUARY.slice(0, 1));
    },
  );
});
