import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Pool } from "pg";
import { createDatabase, type Database } from "@/shared/infrastructure/db/client";
import { runMigrations } from "../../scripts/migrate.mjs";
import { categoryFixture, personalSpaceFixture } from "./fixtures";
import { parsePublishedPort, POSTGRES_IMAGE, waitForPostgres } from "./postgres-global-setup";

export interface DockerResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs the Docker CLI; a failing command is a result to assert on, not an exception. A call still running after
 * 110 s is killed and throws (`spawnSync docker ETIMEDOUT`): Vitest's test timeout cannot interrupt a synchronous call.
 */
export const docker = (...args: string[]): DockerResult => {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 110_000 });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

const dockerOk = (...args: string[]): string => {
  const result = docker(...args);
  if (result.status !== 0)
    throw new Error(`docker ${args.join(" ")} exited ${result.status}: ${result.stderr}`);
  return result.stdout.trim();
};

/** The scripts compose.yaml mounts into the backup containers, mounted at the same paths: /hearth/<name>. */
export const HEARTH_SCRIPTS: string[] = [
  "backup.sh",
  "cron-entrypoint.sh",
  "restore-drill.sh",
  "offsite-copy.sh",
];

/** The image of the optional backup-offsite service. */
export const RCLONE_IMAGE = "rclone/rclone:1.75.1";

export interface RunOptions {
  /** Defaults to POSTGRES_IMAGE, the image of the backup service. */
  readonly image?: string;
  /** Added to, and overriding, DEFAULT_ENV. */
  readonly env?: Readonly<Record<string, string>>;
  /** More volumes by mount target, besides the backups volume at /backups. */
  readonly volumes?: Readonly<Record<string, string>>;
  /** The scripts to mount at /hearth/<name>; defaults to HEARTH_SCRIPTS. Fewer of them reproduce a missing script. */
  readonly scripts?: readonly string[];
}

export interface BackupStack {
  /** The value of the `hearth.test.stack` label on every container, volume and network of the stack. */
  readonly label: string;
  /** The migrated database, from the host, for seeding and checks. */
  readonly db: Database;
  readonly pool: Pool;
  /** Runs `sh -c <script>` in a throwaway container on the stack's network. */
  run(script: string, options?: RunOptions): DockerResult;
  /** Starts a long-running container with this entrypoint and command; returns its id. */
  start(entrypoint: readonly string[], command: readonly string[], options?: RunOptions): string;
  /** Creates a labelled volume and returns its name. */
  volume(): string;
  /** The entries of the backups volume, hidden ones included, sorted by name. */
  backups(): string[];
  /** A container's output, stdout then stderr. */
  logs(id: string): string;
  /** Removes every container, volume and network of the stack; best effort, never hiding an earlier error. */
  stop(): Promise<void>;
}

/** What the backup service gets in compose.yaml, pointed at this stack's database. */
const DEFAULT_ENV: Readonly<Record<string, string>> = {
  PGHOST: "db",
  PGUSER: "hearth",
  PGPASSWORD: "hearth",
  PGDATABASE: "hearth",
  PGCONNECT_TIMEOUT: "5",
  TZ: "America/Bogota",
  BACKUP_DIR: "/backups",
};

const LABEL = "hearth.test.stack";

/** The ids of every container, volume and network that still carries the stack's label. */
export const leftovers = (label: string): string[] =>
  [
    ["ps", "-aq"],
    ["volume", "ls", "-q"],
    ["network", "ls", "-q"],
  ].flatMap((list) =>
    dockerOk(...list, "--filter", `label=${LABEL}=${label}`)
      .split("\n")
      .filter(Boolean),
  );

/** Starts PostgreSQL on a fresh network with a fresh backups volume, migrates it and returns the stack. */
export const startBackupStack = async (): Promise<BackupStack> => {
  const label = randomUUID();
  const network = `hearth-test-${label}`;
  const backupsVolume = `hearth-test-backups-${label}`;
  const tag = ["--label", `${LABEL}=${label}`];
  const containerArgs = (options: RunOptions): string[] => [
    ...tag,
    "--network",
    network,
    // The postgres image declares a volume there: a tmpfs leaves no anonymous volume behind.
    "--tmpfs",
    "/var/lib/postgresql",
    ...Object.entries({ ...DEFAULT_ENV, ...options.env }).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    "--mount",
    `type=volume,source=${backupsVolume},target=/backups`,
    ...Object.entries(options.volumes ?? {}).flatMap(([target, source]) => [
      "--mount",
      `type=volume,source=${source},target=${target}`,
    ]),
    ...(options.scripts ?? HEARTH_SCRIPTS).flatMap((name) => {
      const source = resolve("scripts", name);
      // Docker Desktop creates a missing bind source as an empty directory, which `sh` then runs as a no-op.
      if (!statSync(source, { throwIfNoEntry: false })?.isFile()) throw new Error(`Missing script ${source}`);
      return ["--mount", `type=bind,source=${source},target=/hearth/${name},readonly`];
    }),
  ];
  const stop = async (pool?: Pool) => {
    await pool?.end().catch(() => undefined);
    for (const [list, remove] of [
      [
        ["ps", "-aq"],
        ["rm", "-f", "--volumes"],
      ],
      [
        ["volume", "ls", "-q"],
        ["volume", "rm", "-f"],
      ],
      [
        ["network", "ls", "-q"],
        ["network", "rm"],
      ],
    ] as const) {
      // Each step is on its own: a Docker CLI that times out must not skip the volumes and the network.
      try {
        const ids = docker(...list, "--filter", `label=${LABEL}=${label}`)
          .stdout.split("\n")
          .filter(Boolean);
        if (ids.length > 0 && docker(...remove, ...ids).status !== 0)
          console.warn(`Could not remove ${ids.join(", ")}`);
      } catch (error) {
        console.warn(`Could not clean up with "docker ${remove.join(" ")}": ${String(error)}`);
      }
    }
  };
  try {
    dockerOk("network", "create", ...tag, network);
    dockerOk("volume", "create", ...tag, backupsVolume);
    const db = dockerOk(
      "run",
      "-d",
      "--rm",
      ...tag,
      "--network",
      network,
      "--network-alias",
      "db",
      "--tmpfs",
      "/var/lib/postgresql",
      "-e",
      "POSTGRES_DB=hearth",
      "-e",
      "POSTGRES_USER=hearth",
      "-e",
      "POSTGRES_PASSWORD=hearth",
      "-p",
      `${process.env.TEST_DOCKER_PUBLISH_HOST ?? "127.0.0.1"}::5432`,
      POSTGRES_IMAGE,
    );
    const port = parsePublishedPort(dockerOk("port", db, "5432/tcp"));
    const url = `postgres://hearth:hearth@${process.env.TEST_DATABASE_HOST ?? "127.0.0.1"}:${port}/hearth`;
    await waitForPostgres(url);
    await runMigrations(url, "drizzle");
    const { db: database, pool } = createDatabase(url);
    return {
      label,
      db: database,
      pool,
      run: (script, options = {}) =>
        docker(
          "run",
          "--rm",
          ...containerArgs(options),
          "--entrypoint",
          "sh",
          options.image ?? POSTGRES_IMAGE,
          "-c",
          script,
        ),
      start: (entrypoint, command, options = {}) =>
        dockerOk(
          "run",
          "-d",
          "--rm",
          ...containerArgs(options),
          "--entrypoint",
          entrypoint[0]!,
          options.image ?? POSTGRES_IMAGE,
          ...entrypoint.slice(1),
          ...command,
        ),
      volume: () => dockerOk("volume", "create", ...tag, `hearth-test-${randomUUID()}`),
      backups: () =>
        dockerOk("run", "--rm", ...containerArgs({}), "--entrypoint", "ls", POSTGRES_IMAGE, "-A", "/backups")
          .split("\n")
          .filter(Boolean)
          .sort(),
      logs: (id) => {
        const result = docker("logs", id);
        return result.stdout + result.stderr;
      },
      stop: () => stop(pool),
    };
  } catch (error) {
    await stop().catch(() => undefined);
    throw error;
  }
};

/** The JSON log lines of a script's output, in order; other lines (libpq, pg_dump, crond) are skipped. */
export const logEvents = (output: string): Record<string, unknown>[] =>
  output
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);

export const waitFor = async (check: () => boolean, timeoutMs = 15_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Condition not met after ${timeoutMs} ms`);
    await sleep(250);
  }
};

/** Today's date in a time zone as YYYY-MM-DD. */
export const todayIn = (timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());

/** Today's date in America/Bogota as YYYY-MM-DD, the date a backup is named with. */
export const bogotaToday = (): string => todayIn("America/Bogota");

/** Ana's personal space with one category and `live + deleted` expenses; the deleted ones are soft-deleted (D8). */
export const seedLedger = async (
  stack: BackupStack,
  counts: { live: number; deleted: number },
): Promise<void> => {
  const space = await personalSpaceFixture(stack.db, stack.pool);
  const category = await categoryFixture(stack.db, space);
  for (let i = 0; i < counts.live + counts.deleted; i++) {
    await stack.pool.query(
      `INSERT INTO transactions (id, space_id, type, description, date, category_id, amount, currency, created_by,
         created_at, updated_at, deleted_at)
       VALUES ($1, $2, 'EXPENSE', 'Market', '2026-10-05', $3, 100, 'COP', $4, now(), now(), $5)`,
      [randomUUID(), space.spaceId, category, space.userId, i >= counts.live ? new Date() : null],
    );
  }
};

export const transactionCount = async (stack: BackupStack): Promise<number> =>
  (await stack.pool.query("SELECT count(*)::int AS n FROM transactions")).rows[0].n;
