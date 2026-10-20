import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  logEvents,
  seedLedger,
  startBackupStack,
  transactionCount,
  type BackupStack,
  type RunOptions,
} from "../support/backup-stack";

/**
 * The commands of "Restoring for real" in docs/operations/backups.md, as the shell script to run in the backup
 * container: the documented text is the tested text. `docker compose exec backup <cmd>` runs `<cmd>`, and
 * `docker compose run … --entrypoint sh backup -c '…'` runs `sh -c '…'`.
 */
const documentedRestoreCommand = (needle: string): string => {
  const doc = readFileSync(resolve("docs/operations/backups.md"), "utf8");
  const start = doc.indexOf("## Restoring for real");
  const section = doc.slice(start, doc.indexOf("\n## ", start + 1));
  const matches = [
    ...section.matchAll(
      /^ {8}docker compose (?:exec backup|run --rm --no-deps --entrypoint sh backup) (.+)$/gm,
    ),
  ].filter((m) => m[1]!.includes(needle));
  if (matches.length !== 1) throw new Error(`Expected one documented command with "${needle}"`);
  const [line, command] = [matches[0]![0], matches[0]![1]!];
  return line.includes(" run ") ? `sh ${command}` : command;
};

describe("restore drill (HU-E8-01)", () => {
  let stack: BackupStack;
  let latest: string;
  const drill = (script = "sh /hearth/restore-drill.sh", options?: RunOptions) => {
    const result = stack.run(script, options);
    return { ...result, events: logEvents(result.stdout) };
  };
  const scratchDatabases = async () =>
    (await stack.pool.query("SELECT datname FROM pg_database WHERE datname = 'hearth_restore_drill'")).rows;

  beforeAll(async () => {
    stack = await startBackupStack();
    await seedLedger(stack, { live: 3, deleted: 1 });
    const backup = stack.run("sh /hearth/backup.sh");
    latest = String(logEvents(backup.stdout)[0]!.file);
    // Decoys written after the backup, so the 2020 file is the newest by mtime but not by name (the drill must go
    // by name), and a hidden partial of a far-future day must not count as a backup. Their headers claim 999.
    stack.run(
      "echo '-- hearth-backup transactions=999' | gzip > /backups/hearth-2020-01-01.sql.gz; " +
        "echo '-- hearth-backup transactions=999' | gzip > /backups/.hearth-2099-01-01.sql.gz.1.partial",
    );
    // Production moves on after the backup: the drill compares with the count at backup time.
    await seedLedger(stack, { live: 1, deleted: 0 });
  });
  afterAll(() => stack?.stop());

  it("restores the newest backup into a scratch database, finds its 4 transactions and removes the scratch database", async () => {
    const result = drill();
    expect(result.status).toBe(0);
    expect(result.events).toEqual([
      expect.objectContaining({
        level: "info",
        event: "restore_drill_passed",
        job: "restore-drill",
        file: latest,
        transactions: 4,
      }),
    ]);
    expect(await scratchDatabases()).toEqual([]);
    expect(await transactionCount(stack)).toBe(5);
  });

  it("drops a scratch database an earlier drill left behind before restoring", async () => {
    await stack.pool.query("CREATE DATABASE hearth_restore_drill");
    expect(drill().status).toBe(0);
    expect(await scratchDatabases()).toEqual([]);
  });

  it("drops a leftover scratch database even while a session is still connected to it", async () => {
    await stack.pool.query("CREATE DATABASE hearth_restore_drill");
    const url = stack.pool.options.connectionString!.replace(/\/hearth$/, "/hearth_restore_drill");
    const session = new Client({ connectionString: url });
    session.on("error", () => undefined); // the drill terminates this session
    await session.connect();
    try {
      // The session really is on the scratch database, so FORCE is what lets the drill drop it.
      expect((await session.query("SELECT current_database() AS name")).rows[0].name).toBe(
        "hearth_restore_drill",
      );
      expect(drill().status).toBe(0);
      expect(await scratchDatabases()).toEqual([]);
    } finally {
      await session.end().catch(() => undefined);
    }
  });

  it("fails with CountMismatch when the restored count is not the recorded one, and still removes the scratch database", async () => {
    const result = drill(
      `gunzip -c /backups/${latest} | sed '1s/=.*/=999/' | gzip > /tmp/tampered.sql.gz && sh /hearth/restore-drill.sh /tmp/tampered.sql.gz`,
    );
    expect(result.status).toBe(1);
    expect(result.events).toEqual([
      expect.objectContaining({
        level: "error",
        event: "restore_drill_failed",
        job: "restore-drill",
        reason: "CountMismatch",
        expected: 999,
        actual: 4,
      }),
    ]);
    expect(await scratchDatabases()).toEqual([]);
    expect(await transactionCount(stack)).toBe(5);
  });

  it("fails with RestoreFailed on a dump that does not restore, and still removes the scratch database", async () => {
    const result = drill(
      "{ echo '-- hearth-backup transactions=4'; echo 'SELECT * FROM missing_table;'; } | gzip > /tmp/broken.sql.gz && sh /hearth/restore-drill.sh /tmp/broken.sql.gz",
    );
    expect(result.status).toBe(1);
    expect(result.events).toEqual([
      expect.objectContaining({ event: "restore_drill_failed", reason: "RestoreFailed" }),
    ]);
    expect(await scratchDatabases()).toEqual([]);
    expect(await transactionCount(stack)).toBe(5);
  });

  it("fails with RestoreFailed on a gzip without its trailer, even though all its SQL restores", async () => {
    // The 8 bytes cut off are the CRC and size: gunzip prints every statement, then reports corrupted data.
    const result = drill(
      "{ echo '-- hearth-backup transactions=0'; echo 'CREATE TABLE public.transactions (id int);'; } | gzip > /tmp/whole.sql.gz && " +
        "head -c $(( $(wc -c < /tmp/whole.sql.gz) - 8 )) /tmp/whole.sql.gz > /tmp/cut.sql.gz && sh /hearth/restore-drill.sh /tmp/cut.sql.gz",
    );
    expect(result.status).toBe(1);
    expect(result.events).toEqual([
      expect.objectContaining({ event: "restore_drill_failed", reason: "RestoreFailed" }),
    ]);
    expect(await scratchDatabases()).toEqual([]);
  });

  it("fails with ServerUnreachable when the server cannot be reached", () => {
    const result = drill("sh /hearth/restore-drill.sh", { env: { PGHOST: "nohost.invalid" } });
    expect(result.status).toBe(1);
    expect(result.events).toEqual([
      expect.objectContaining({ event: "restore_drill_failed", reason: "ServerUnreachable" }),
    ]);
  });

  it("fails with Interrupted when it receives a signal, and still removes the scratch database", async () => {
    // A dump that keeps the restore busy for ten minutes: the drill is stopped while its psql is running, and must
    // not wait for it (a signal handled only after the foreground psql ends would take the full ten minutes).
    const started = Date.now();
    const result = drill(
      [
        "{ echo '-- hearth-backup transactions=4'; echo 'SELECT pg_sleep(600);'; } | gzip > /tmp/slow.sql.gz",
        "sh /hearth/restore-drill.sh /tmp/slow.sql.gz > /tmp/drill.out &",
        "pid=$!",
        `until [ "$(psql -X -Atc "SELECT count(*) FROM pg_database WHERE datname = 'hearth_restore_drill'" -d postgres)" = 1 ]; do sleep 1; done`,
        "sleep 1",
        "kill -TERM $pid",
        "wait $pid",
        'echo "status=$?"',
        "cat /tmp/drill.out",
      ].join("\n"),
    );
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(result.stdout).toContain("status=1");
    expect(result.events).toEqual([
      expect.objectContaining({ event: "restore_drill_failed", reason: "Interrupted" }),
    ]);
    expect(await scratchDatabases()).toEqual([]);
  });

  it.each([
    ["a missing file", "sh /hearth/restore-drill.sh /backups/hearth-1999-01-01.sql.gz", "NoBackup"],
    [
      "an empty backup directory",
      "mkdir /tmp/empty && BACKUP_DIR=/tmp/empty sh /hearth/restore-drill.sh",
      "NoBackup",
    ],
    [
      "a dump without the count line",
      "echo 'SELECT 1;' | gzip > /tmp/plain.sql.gz && sh /hearth/restore-drill.sh /tmp/plain.sql.gz",
      "MissingCount",
    ],
  ])("fails with %s", (_, script, reason) => {
    const result = drill(script);
    expect(result.status).toBe(1);
    expect(result.events).toEqual([expect.objectContaining({ event: "restore_drill_failed", reason })]);
  });

  describe("restoring for real, with the commands the documentation gives", () => {
    const safetyCopy = () => documentedRestoreCommand("pg_dump");
    const recreate = () => documentedRestoreCommand("DROP DATABASE");
    const restore = (file = latest) =>
      documentedRestoreCommand("-d hearth'").replaceAll("hearth-2026-11-12.sql.gz", file);
    const check = () => documentedRestoreCommand("head -n 1").replaceAll("hearth-2026-11-12.sql.gz", latest);

    it("does not keep a safety copy it could not make, and does not say it is ok", () => {
      const result = stack.run(safetyCopy(), { env: { PGHOST: "nohost.invalid" } });
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain("safety copy ok");
      expect(stack.backups().filter((name) => name.startsWith("before-restore"))).toEqual([]);
    });

    it("fails, instead of loading nothing, when the dump to restore is missing", () => {
      expect(stack.run(restore("hearth-1999-01-01.sql.gz")).status).not.toBe(0);
    });

    it("brings the database back to the backup, with its migrations, and keeps a whole safety copy", async () => {
      // FORCE ends the pool's idle sessions; the pool must not treat that as a crash.
      stack.pool.on("error", () => undefined);

      const safety = stack.run(safetyCopy());
      expect(safety.status).toBe(0);
      expect(safety.stdout).toMatch(
        /^safety copy ok: \/backups\/before-restore-\d{4}-\d{2}-\d{2}-\d{4}\.sql\.gz$/m,
      );

      expect(stack.run(recreate()).status).toBe(0);
      // A dump that fails half way leaves no half-restored database: the restore is one transaction.
      const half = stack.run(
        "{ echo 'CREATE TABLE half_restored (id int);'; echo 'SELECT * FROM missing_table;'; } | gzip > /backups/half.sql.gz",
      );
      expect(half.status).toBe(0);
      expect(stack.run(restore("half.sql.gz")).status).not.toBe(0);
      const leftovers = stack.run(
        `psql -X -Atc "SELECT count(*) FROM information_schema.tables WHERE table_name = 'half_restored'" -d hearth`,
      );
      expect(leftovers.stdout.trim()).toBe("0");
      expect(stack.run(restore()).status).toBe(0);
      // The first line is the count recorded at backup time, the second the count in the restored database.
      expect(stack.run(check()).stdout.trim().split("\n")).toEqual(["-- hearth-backup transactions=4", "4"]);
      // A new session: the pool's idle ones were ended by the DROP.
      const session = new Client({ connectionString: stack.pool.options.connectionString });
      await session.connect();
      try {
        const counts = await session.query(
          `SELECT (SELECT count(*)::int FROM public.transactions) AS transactions,
                  (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS migrations`,
        );
        expect(counts.rows[0].transactions).toBe(4);
        expect(counts.rows[0].migrations).toBeGreaterThan(0);
      } finally {
        await session.end();
      }

      // The copy was taken before the restore, so it holds the 5 transactions production had, and a whole gzip.
      const rows = stack.run(
        String.raw`f=$(ls /backups/before-restore-*.sql.gz) && gzip -t "$f" && gunzip -c "$f" | awk '/^COPY public.transactions /{f=1;next} $0=="\\."{f=0} f' | wc -l`,
      );
      expect(rows.status).toBe(0);
      expect(Number(rows.stdout)).toBe(5);
      // The retention never prunes it.
      expect(stack.run("sh /hearth/backup.sh").status).toBe(0);
      expect(stack.backups().filter((name) => name.startsWith("before-restore"))).toHaveLength(1);
    });
  });
});
