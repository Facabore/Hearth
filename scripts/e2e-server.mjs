import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";
import { runMigrations } from "./migrate.mjs";

/**
 * Ruling P133: the e2e server. A disposable PostgreSQL through the Docker CLI (or TEST_DATABASE_URL), every migration,
 * then the standalone build exactly as the Docker image runs it. Playwright starts this script and stops it at the end.
 */
const PORT = process.env.E2E_PORT ?? "3100";
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8" }).trim();
let container;
let server;

const stop = () => {
  server?.kill("SIGTERM");
  server = undefined;
  if (container) {
    try {
      docker("rm", "-f", "--volumes", container);
    } catch (error) {
      console.warn(`Could not remove the e2e database container ${container}`, error);
    }
    container = undefined;
  }
};
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => (stop(), process.exit(0)));
process.on("exit", stop);

if (!existsSync(".next/standalone/server.js")) {
  console.error("Missing .next/standalone/server.js: run `pnpm build` first.");
  process.exit(1);
}

let url = process.env.TEST_DATABASE_URL;
if (!url) {
  container = docker(
    "run",
    "-d",
    "--rm",
    "--label",
    "hearth.test=e2e",
    "--label",
    // The teardown removes only its own run's containers (tests/e2e/support/base-url.ts).
    `hearth.test.e2e.port=${PORT}`,
    "-e",
    "POSTGRES_DB=hearth",
    "-e",
    "POSTGRES_USER=hearth",
    "-e",
    "POSTGRES_PASSWORD=hearth",
    "--tmpfs",
    "/var/lib/postgresql",
    "-p",
    "127.0.0.1::5432",
    "postgres:18.6-alpine",
  );
  url = `postgres://hearth:hearth@127.0.0.1:${docker("port", container, "5432/tcp").split("\n")[0].split(":").pop()}/hearth`;
}
for (let deadline = Date.now() + 60_000; ;) {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    await client.query("SELECT 1");
    break;
  } catch (error) {
    if (Date.now() > deadline) throw new Error("PostgreSQL not ready after 60 s", { cause: error });
    await sleep(500);
  } finally {
    await client.end().catch(() => undefined);
  }
}
await runMigrations(url, "drizzle");
// The standalone server serves .next/static only from beside itself, as the Dockerfile copies it.
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
server = spawn(process.execPath, [".next/standalone/server.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT,
    HOSTNAME: "127.0.0.1",
    DATABASE_URL: url,
    BETTER_AUTH_SECRET: "e2e-only-secret-0123456789abcdef0123",
    BETTER_AUTH_URL: `http://127.0.0.1:${PORT}`,
    APP_TIMEZONE: "America/Bogota",
    LOG_LEVEL: "error",
    RECURRENCE_JOB_INTERVAL_SECONDS: "0",
    HEARTH_E2E_FIXED_NOW: process.env.HEARTH_E2E_FIXED_NOW ?? "2026-11-01T04:30:00Z",
  },
});
server.on("exit", (code) => {
  stop();
  process.exit(code ?? 1);
});
