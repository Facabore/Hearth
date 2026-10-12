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

/** The host port from `docker port` output such as "127.0.0.1:49153" (first mapping wins). */
export const parsePublishedPort = (output: string): string => {
  const port = output.split("\n")[0]?.match(/:(\d+)$/)?.[1];
  if (!port) throw new Error(`No published port for the test database container: ${JSON.stringify(output)}`);
  return port;
};

const startContainer = (): string =>
  docker(
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
    `${process.env.TEST_DOCKER_PUBLISH_HOST ?? "127.0.0.1"}::5432`,
    POSTGRES_IMAGE,
  );

/** Best effort: a failed removal is reported but never hides the error that triggered it. */
const removeContainer = (id: string): void => {
  try {
    docker("rm", "-f", id);
  } catch (error) {
    console.warn(`Could not remove test database container ${id}`, error);
  }
};

/**
 * Starts a disposable PostgreSQL container through the Docker CLI, migrates it and provides its URL.
 * TEST_DATABASE_URL points the suite at an existing disposable database instead (e.g. a CI service).
 * Inside a container, set TEST_DOCKER_PUBLISH_HOST=0.0.0.0 and TEST_DATABASE_HOST=host.docker.internal.
 */
export default async function setup(project: TestProject) {
  let containerId: string | undefined;
  try {
    let url = process.env.TEST_DATABASE_URL;
    if (!url) {
      containerId = startContainer();
      const port = parsePublishedPort(docker("port", containerId, "5432/tcp"));
      url = `postgres://hearth:hearth@${process.env.TEST_DATABASE_HOST ?? "127.0.0.1"}:${port}/hearth`;
    }
    await waitForPostgres(url);
    await runMigrations(url, "drizzle");
    project.provide("databaseUrl", url);
    project.provide("adminDatabaseUrl", adminUrlOf(url));
  } catch (error) {
    if (containerId) removeContainer(containerId);
    throw error;
  }
  return () => {
    if (containerId) removeContainer(containerId);
  };
}
