import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { logEvents, RCLONE_IMAGE, startBackupStack, type BackupStack } from "../support/backup-stack";

describe("off-site copy (HU-E8-01, optional)", () => {
  let stack: BackupStack;
  let offsite: string;
  /** rclone's local backend stands in for a real provider: the remote "offsite" is a directory of another volume. */
  const LOCAL = { RCLONE_CONFIG_OFFSITE_TYPE: "local", BACKUP_OFFSITE_REMOTE: "offsite:/offsite/hearth" };
  const copy = (env: Record<string, string>) => {
    const result = stack.run("sh /hearth/offsite-copy.sh", {
      image: RCLONE_IMAGE,
      env,
      volumes: { "/offsite": offsite },
    });
    return { ...result, events: logEvents(result.stdout) };
  };
  const remoteFiles = () =>
    stack
      .run("ls -A /offsite/hearth", { volumes: { "/offsite": offsite } })
      .stdout.split("\n")
      .filter(Boolean);

  beforeAll(async () => {
    stack = await startBackupStack();
    offsite = stack.volume();
    stack.run(
      "echo a | gzip > /backups/hearth-2026-10-18.sql.gz && echo b | gzip > /backups/hearth-2026-10-19.sql.gz && touch /backups/notes.txt /backups/.hearth-2026-10-20.sql.gz.4242.partial && mkdir /backups/old && echo c | gzip > /backups/old/hearth-2026-01-01.sql.gz",
    );
  });
  afterAll(() => stack?.stop());

  it("copies every backup, and nothing else, to the configured remote", () => {
    const result = copy(LOCAL);
    expect(result.status).toBe(0);
    expect(result.events).toEqual([
      expect.objectContaining({
        level: "info",
        event: "offsite_copy_finished",
        job: "offsite-copy",
        remote: "offsite",
      }),
    ]);
    expect(remoteFiles()).toEqual(["hearth-2026-10-18.sql.gz", "hearth-2026-10-19.sql.gz"]);
  });

  it("never deletes on the remote a backup the volume no longer holds", () => {
    stack.run("rm /backups/hearth-2026-10-18.sql.gz");
    expect(copy(LOCAL).status).toBe(0);
    expect(remoteFiles()).toEqual(["hearth-2026-10-18.sql.gz", "hearth-2026-10-19.sql.gz"]);
  });

  it.each([
    ["a connection string carries parameters", "offsite,secret_access_key=hunter2:bucket"],
    ["a parameter value would break the log line", 'offsite,description="x:bucket'],
    ["the remote is a local path", "/offsite/hearth"],
    ["the remote has no name", ":bucket"],
    ["the remote has no colon", "offsite"],
  ])("refuses to run, naming nothing of the value, when %s", (_, remote) => {
    const result = copy({ ...LOCAL, BACKUP_OFFSITE_REMOTE: remote });
    expect(result.status).toBe(1);
    expect(result.events).toEqual([
      expect.objectContaining({
        level: "error",
        event: "offsite_copy_failed",
        job: "offsite-copy",
        reason: "InvalidRemote",
      }),
    ]);
    expect(result.stdout + result.stderr).not.toContain("hunter2");
  });

  it("gives up on an unreachable endpoint in seconds, not rclone's default of minutes", () => {
    // Nothing listens there: rclone's default retries with pacer back-off take about 7 minutes (the harness times out at 110 s).
    const started = Date.now();
    const result = copy({
      BACKUP_OFFSITE_REMOTE: "offsite:bucket/hearth",
      RCLONE_CONFIG_OFFSITE_TYPE: "s3",
      RCLONE_CONFIG_OFFSITE_PROVIDER: "Other",
      RCLONE_CONFIG_OFFSITE_ENDPOINT: "http://127.0.0.1:9",
      RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID: "key",
      RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY: "secret",
    });
    expect(result.status).toBe(1);
    expect(result.events).toEqual([
      expect.objectContaining({ event: "offsite_copy_failed", reason: "CopyFailed" }),
    ]);
    expect(Date.now() - started).toBeLessThan(100_000);
  });

  it.each([
    ["no remote is set", {}, "MissingRemote"],
    ["the remote is not configured", { BACKUP_OFFSITE_REMOTE: "nowhere:hearth" }, "CopyFailed"],
  ])("exits 1 when %s", (_, env, reason) => {
    const result = copy(env);
    expect(result.status).toBe(1);
    expect(result.events).toEqual([
      expect.objectContaining({ level: "error", event: "offsite_copy_failed", job: "offsite-copy", reason }),
    ]);
  });
});
