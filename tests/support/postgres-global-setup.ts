import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { runMigrations } from "../../scripts/migrate.mjs";

export const POSTGRES_IMAGE = "postgres:18.6-alpine";

const docker = (...args: string[]): string => execFileSync("docker", args, { encoding: "utf8" }).trim();

/** The same server, connected to its maintenance database (used to create throwaway databases). */
export const adminUrlOf = (url: string): string => {
  const admin = new URL(url);
  admin.pathname = "/postgres";
  return admin.toString();
};

const waitForPostgres = async (url: string, timeoutMs = 60_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      await client.query("SELECT 1");
      return;
    } catch (error) {
      if (Date.now() > deadline)
        throw new Error(`PostgreSQL not ready after ${timeoutMs} ms`, { cause: error });
      await sleep(500);
    } finally {
      await client.end().catch(() => undefined);
    }
  }
};

/**
 * Starts a disposable PostgreSQL container through the Docker CLI, migrates it and provides its URL.
 * TEST_DATABASE_URL points the suite at an existing disposable database instead (e.g. a CI service).
 * Inside a container, set TEST_DOCKER_PUBLISH_HOST=0.0.0.0 and TEST_DATABASE_HOST=host.docker.internal.
 */
export default async function setup(project: TestProject) {
  let url = process.env.TEST_DATABASE_URL;
  let containerId: string | undefined;
  if (!url) {
    const publishHost = process.env.TEST_DOCKER_PUBLISH_HOST ?? "127.0.0.1";
    containerId = docker(
      "run",
      "-d",
      "--rm",
      "--label",
      "hearth.test=true",
      "-e",
      "POSTGRES_DB=hearth",
      "-e",
      "POSTGRES_USER=hearth",
      "-e",
      "POSTGRES_PASSWORD=hearth",
      "-p",
      `${publishHost}::5432`,
      POSTGRES_IMAGE,
    );
    const port = docker("port", containerId, "5432/tcp").split("\n")[0]!.split(":").at(-1);
    url = `postgres://hearth:hearth@${process.env.TEST_DATABASE_HOST ?? "127.0.0.1"}:${port}/hearth`;
  }
  try {
    await waitForPostgres(url);
    await runMigrations(url, "drizzle");
  } catch (error) {
    if (containerId) docker("rm", "-f", containerId);
    throw error;
  }
  project.provide("databaseUrl", url);
  project.provide("adminDatabaseUrl", adminUrlOf(url));
  return () => {
    if (containerId) docker("rm", "-f", containerId);
  };
}
