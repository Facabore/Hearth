import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bogotaToday,
  docker,
  logEvents,
  RCLONE_IMAGE,
  startBackupStack,
  todayIn,
  waitFor,
  type BackupStack,
} from "../support/backup-stack";

interface ComposeService {
  readonly image: string;
  readonly entrypoint?: string[];
  readonly command?: string[];
  readonly environment?: Record<string, string>;
  readonly ports?: unknown[];
  readonly tmpfs?: string[];
  readonly profiles?: string[];
  readonly networks?: Record<string, unknown>;
  readonly restart?: string;
  readonly depends_on?: Record<string, { condition?: string }>;
  readonly volumes?: { type: string; source: string; target: string; read_only?: boolean | null }[];
}

/** `docker compose` on the production file, with the variables an operator copies from .env.production.example. */
const compose = (args: string[], env: Record<string, string> = {}, file = "compose.yaml"): string => {
  const environment: NodeJS.ProcessEnv = { ...process.env, POSTGRES_PASSWORD: "test", ...env };
  // A developer's shell variables beat --env-file: the defaults under test must not depend on them.
  for (const name of ["COMPOSE_PROFILES", "APP_TIMEZONE", "BACKUP_RETENTION_DAYS", "HEARTH_SIGN_UP"])
    if (!(name in env)) delete environment[name];
  const result = spawnSync(
    "docker",
    ["compose", "-f", file, "--env-file", ".env.production.example", ...args],
    // 110 s like every Docker CLI call of the harness: Vitest's test timeout cannot interrupt a synchronous call.
    { encoding: "utf8", env: environment, timeout: 110_000 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
};
const services = (env: Record<string, string> = {}): Record<string, ComposeService> =>
  JSON.parse(compose(["config", "--format", "json"], env)).services;
/** Each mount as [kind:source, target, read-only]; a bind's source is its path from scripts/ on (`bind:scripts`). */
const mounts = (service: ComposeService) =>
  (service.volumes ?? []).map((v) => [
    v.type === "bind"
      ? `bind:${v.source.replaceAll("\\", "/").replace(/^.*\/scripts/, "scripts")}`
      : `${v.type}:${v.source}`,
    v.target,
    v.read_only === true,
  ]);

describe("compose.yaml backups (HU-E8-01)", () => {
  it("publishes ports from caddy only, never from PostgreSQL or the backups", () => {
    const published = Object.entries(services()).filter(([, s]) => s.ports !== undefined);
    expect(published.map(([name]) => name)).toEqual(["caddy"]);
  });

  it("opens sign-up by default and closes it to visitors without an invitation when HEARTH_SIGN_UP is closed (ruling P143)", () => {
    expect(services().app!.environment).toMatchObject({ HEARTH_SIGN_UP: "open" });
    expect(services({ HEARTH_SIGN_UP: "closed" }).app!.environment).toMatchObject({
      HEARTH_SIGN_UP: "closed",
    });
  });

  it("runs backup from the db image at 02:00 in APP_TIMEZONE, America/Bogota by default, keeping 14 backups", () => {
    const { backup, db } = services();
    expect(backup).toMatchObject({
      image: db!.image,
      entrypoint: ["sh", "/hearth/cron-entrypoint.sh"],
      command: ["0 2 * * *", "sh /hearth/backup.sh"],
      tmpfs: ["/var/lib/postgresql"],
      restart: "unless-stopped",
      networks: { internal: null },
      depends_on: { db: expect.objectContaining({ condition: "service_healthy" }) },
    });
    expect(backup!.environment).toEqual({
      TZ: "America/Bogota",
      PGHOST: "db",
      PGUSER: "hearth",
      PGPASSWORD: "test",
      PGDATABASE: "hearth",
      PGCONNECT_TIMEOUT: "10",
      BACKUP_DIR: "/backups",
      BACKUP_RETENTION_DAYS: "14",
    });
    // The whole directory, so a missing scripts/ fails loudly (P116) instead of mounting empty directories.
    expect(mounts(backup!)).toEqual([
      ["volume:backups", "/backups", false],
      ["bind:scripts", "/hearth", true],
    ]);
    expect(
      services({ APP_TIMEZONE: "America/Lima", BACKUP_RETENTION_DAYS: "30" }).backup!.environment,
    ).toMatchObject({
      TZ: "America/Lima",
      BACKUP_RETENTION_DAYS: "30",
    });
  });

  it("serves the single-page app from the web image on the internal network only, and never holds Caddy back on it (ADR 0006)", () => {
    const { caddy, web } = services();
    expect(web).toMatchObject({ restart: "unless-stopped", networks: { internal: null } });
    expect(web!.ports).toBeUndefined();
    expect(caddy!.depends_on).toMatchObject({ web: { condition: "service_started" } });
  });

  it("leaves backup-offsite out unless COMPOSE_PROFILES names offsite", () => {
    const names = (env: Record<string, string> = {}) =>
      compose(["config", "--services"], env).trim().split("\n").sort();
    expect(names()).toEqual(["app", "backup", "caddy", "db", "migrate", "web"]);
    expect(names({ COMPOSE_PROFILES: "offsite" })).toContain("backup-offsite");
  });

  it("runs backup-offsite at 03:00 from rclone, reading the backups read-only, on a network without the database", () => {
    const offsite = services({ COMPOSE_PROFILES: "offsite" })["backup-offsite"]!;
    expect(offsite).toMatchObject({
      image: RCLONE_IMAGE,
      profiles: ["offsite"],
      restart: "unless-stopped",
      entrypoint: ["sh", "/hearth/cron-entrypoint.sh"],
      command: ["0 3 * * *", "sh /hearth/offsite-copy.sh"],
    });
    // Exactly these: no database credential may reach the one container that talks to the internet (P112).
    expect(offsite.environment).toEqual({ TZ: "America/Bogota", BACKUP_DIR: "/backups" });
    expect(Object.keys(offsite.networks ?? {})).toEqual(["offsite"]);
    // And nothing else, the database included, is on its network.
    const onOffsite = Object.entries(services({ COMPOSE_PROFILES: "offsite" }))
      .filter(([, service]) => "offsite" in (service.networks ?? {}))
      .map(([name]) => name);
    expect(onOffsite).toEqual(["backup-offsite"]);
    expect(offsite.depends_on).toBeUndefined();
    expect(offsite.ports).toBeUndefined();
    expect(mounts(offsite)).toEqual([
      ["volume:backups", "/backups", true],
      ["bind:scripts", "/hearth", true],
    ]);
  });

  it("loads only .env.offsite into backup-offsite, never .env", () => {
    // The project's own compose.yaml next to a throwaway .env.offsite and .env: a leak shows in the resolved environment.
    const dir = mkdtempSync(join(tmpdir(), "hearth-compose-"));
    try {
      copyFileSync("compose.yaml", join(dir, "compose.yaml"));
      writeFileSync(
        join(dir, ".env.offsite"),
        ["BACKUP_OFFSITE_REMOTE=offsite:bucket", "RCLONE_CONFIG_OFFSITE_TYPE=local", ""].join("\n"),
      );
      writeFileSync(
        join(dir, ".env"),
        ["POSTGRES_PASSWORD=from-dot-env", "BETTER_AUTH_SECRET=from-dot-env", ""].join("\n"),
      );
      const resolved = JSON.parse(
        compose(["config", "--format", "json"], { COMPOSE_PROFILES: "offsite" }, join(dir, "compose.yaml")),
      ).services["backup-offsite"] as ComposeService;
      expect(resolved.environment).toEqual({
        TZ: "America/Bogota",
        BACKUP_DIR: "/backups",
        BACKUP_OFFSITE_REMOTE: "offsite:bucket",
        RCLONE_CONFIG_OFFSITE_TYPE: "local",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("the scheduled job", () => {
    let stack: BackupStack;
    beforeAll(async () => {
      stack = await startBackupStack();
    });
    afterAll(() => stack?.stop());

    it("is a root-owned crontab line in a container on Bogota time, whose command writes a backup and logs it", async () => {
      const backup = services().backup!;
      const id = stack.start(backup.entrypoint!, backup.command!, {
        env: { TZ: backup.environment!.TZ! },
      });
      await waitFor(() => stack.logs(id).includes("crond (busybox"));
      const exec = (...args: string[]) => docker("exec", id, ...args).stdout.trim();
      const crontab = exec("cat", "/etc/crontabs/root");
      expect(crontab).toBe("0 2 * * * sh /hearth/backup.sh > /proc/1/fd/1 2> /proc/1/fd/2");
      expect(exec("stat", "-c", "%u", "/etc/crontabs/root")).toBe("0");
      expect(exec("date", "+%Z")).toBe("-05");
      const today = bogotaToday();
      expect(docker("exec", id, "sh", "-c", crontab.slice("0 2 * * * ".length)).status).toBe(0);
      await waitFor(() => stack.logs(id).includes("backup_written"));
      expect(logEvents(stack.logs(id))).toEqual([
        expect.objectContaining({ event: "backup_written", job: "nightly-backup" }),
      ]);
      expect(stack.backups()).toEqual([`hearth-${today}.sql.gz`]);
    });

    /** The service's own entrypoint and command as one shell line, under `timeout`, so a start that works cannot hang. */
    const serviceLine = () => {
      const { entrypoint, command } = services().backup!;
      return `timeout -s KILL 10 ${[...entrypoint!, ...command!].map((word) => `'${word}'`).join(" ")}; exit $?`;
    };

    it("refuses to start when backup.sh is a directory, as Docker makes of a missing bind source", () => {
      // Without the guard crond -f would run forever.
      const result = stack.run(serviceLine(), {
        scripts: ["cron-entrypoint.sh"],
        volumes: { "/hearth/backup.sh": stack.volume() },
      });
      expect(result.status).toBe(66);
      expect(result.stderr).toContain("/hearth/backup.sh is not a file");
    });

    it("refuses to start when backup.sh is missing from the mounted scripts", () => {
      const result = stack.run(serviceLine(), { scripts: ["cron-entrypoint.sh"] });
      expect(result.status).toBe(66);
      expect(result.stderr).toContain("/hearth/backup.sh is not a file");
    });

    it("fails with a non-zero status, not a silent no-op, when scripts/ is missing altogether", () => {
      // The compose service mounts the whole directory (P116): without it /hearth is empty, never a directory
      // standing where the entrypoint should be, which sh would run as a no-op.
      const result = stack.run(serviceLine(), { scripts: [], volumes: { "/hearth": stack.volume() } });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("/hearth/cron-entrypoint.sh");
    });

    it("removes the partial files a killed run left, and nothing else, when it starts", () => {
      stack.run(
        "touch /backups/.hearth-2020-01-01.sql.gz.123.partial /backups/.notes.partial /backups/hearth-2020-01-01.sql.gz /backups/notes.txt",
        { scripts: [] },
      );
      stack.run(serviceLine());
      expect(stack.backups()).toEqual(
        expect.arrayContaining([".notes.partial", "hearth-2020-01-01.sql.gz", "notes.txt"]),
      );
      expect(stack.backups()).not.toContain(".hearth-2020-01-01.sql.gz.123.partial");
    });

    it("schedules the off-site copy the same way in the rclone image", async () => {
      const offsite = services({ COMPOSE_PROFILES: "offsite" })["backup-offsite"]!;
      const id = stack.start(offsite.entrypoint!, offsite.command!, {
        image: RCLONE_IMAGE,
        env: { TZ: offsite.environment!.TZ! },
      });
      await waitFor(() => stack.logs(id).includes("crond (busybox"));
      const exec = (...args: string[]) => docker("exec", id, ...args).stdout.trim();
      expect(exec("cat", "/etc/crontabs/root")).toBe(
        "0 3 * * * sh /hearth/offsite-copy.sh > /proc/1/fd/1 2> /proc/1/fd/2",
      );
      expect(exec("stat", "-c", "%u", "/etc/crontabs/root")).toBe("0");
      expect(exec("date", "+%Z")).toBe("-05");
    });

    it("refuses to start the off-site copy when offsite-copy.sh is missing from the mounted scripts", () => {
      const { entrypoint, command } = services({ COMPOSE_PROFILES: "offsite" })["backup-offsite"]!;
      const line = [...entrypoint!, ...command!].map((word) => `'${word}'`).join(" ");
      const result = stack.run(`timeout -s KILL 10 ${line}; exit $?`, {
        image: RCLONE_IMAGE,
        scripts: ["cron-entrypoint.sh"],
      });
      expect(result.status).toBe(66);
      expect(result.stderr).toContain("/hearth/offsite-copy.sh is not a file");
    });

    it("does not remove the partial files of a running backup when backup-offsite starts", () => {
      // The backup writes its partial file while backup-offsite may start (docker compose up -d): it owns none.
      stack.run("touch /backups/.hearth-2020-01-02.sql.gz.456.partial", { scripts: [] });
      const { entrypoint, command } = services({ COMPOSE_PROFILES: "offsite" })["backup-offsite"]!;
      const line = [...entrypoint!, ...command!].map((word) => `'${word}'`).join(" ");
      stack.run(`timeout -s KILL 10 ${line}; exit $?`, { image: RCLONE_IMAGE });
      expect(stack.backups()).toContain(".hearth-2020-01-02.sql.gz.456.partial");
      stack.run("rm /backups/.hearth-2020-01-02.sql.gz.456.partial", { scripts: [] });
    });

    it("refuses to start without exactly a schedule and a command", () => {
      const result = stack.run("sh /hearth/cron-entrypoint.sh '0 2 * * *'");
      expect(result.status).toBe(64);
      expect(result.stderr).toContain("usage: cron-entrypoint.sh");
    });

    it("has crond itself run the job every minute with the container's zone and database variables", async () => {
      // A zone whose date differs from UTC's, so a job that lost TZ would name its file with the UTC date.
      const timeZone = new Date().getUTCHours() < 11 ? "Etc/GMT+12" : "Pacific/Kiritimati";
      expect(todayIn(timeZone)).not.toBe(todayIn("UTC"));
      const { entrypoint, command } = services().backup!;
      const days = [todayIn(timeZone)];
      const id = stack.start(entrypoint!, ["* * * * *", command![1]!], { env: { TZ: timeZone } });
      // At most a minute to the next minute boundary, then the dump: crond logs the job's own output.
      await waitFor(() => stack.logs(id).includes("backup_written"), 90_000);
      days.push(todayIn(timeZone));
      const [event] = logEvents(stack.logs(id));
      expect(event).toMatchObject({ event: "backup_written", job: "nightly-backup" });
      expect(days.map((day) => `hearth-${day}.sql.gz`)).toContain(String(event!.file));
    });
  });
});
