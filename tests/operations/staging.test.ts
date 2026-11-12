import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { docker, logEvents } from "../support/backup-stack";

/** ADR 0008: `docker compose` on production's file with staging's override, as `/opt/hearth-staging` runs it. */
const staging = (args: string[]): string => {
  const result = spawnSync(
    "docker",
    [
      "compose",
      "-f",
      "compose.yaml",
      "-f",
      "deploy/staging/compose.staging.yaml",
      "--env-file",
      ".env.production.example",
      ...args,
    ],
    { encoding: "utf8", env: { ...process.env, POSTGRES_PASSWORD: "test" }, timeout: 110_000 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
};

describe("staging's compose override (ADR 0008)", () => {
  it("is a project of its own, on loopback ports 5310 and 5311, with the bundled Caddy off", () => {
    const config = JSON.parse(staging(["config", "--format", "json"])) as {
      name: string;
      services: Record<string, { ports?: { host_ip: string; published: string; target: number }[] }>;
    };
    // Its own project: its own containers, network and database volume, never production's `hearth`.
    expect(config.name).toBe("hearth-staging");
    const ports = (service: string) =>
      (config.services[service]?.ports ?? []).map((p) => `${p.host_ip}:${p.published}:${p.target}`);
    expect(ports("app")).toEqual(["127.0.0.1:5310:3000"]);
    expect(ports("web")).toEqual(["127.0.0.1:5311:8080"]);
    expect(ports("db")).toEqual([]);
    expect(Object.keys(config.services)).not.toContain("caddy");
  });
});

/** A `docker` that answers the script from a state directory and records every call (no daemon, no network). */
const STUB = String.raw`#!/bin/sh
echo "$*" >> /state/calls
case "$*" in
  *" config --images"*) printf 'ghcr.io/facabore/hearth:development\nghcr.io/facabore/hearth-migrator:development\nghcr.io/facabore/hearth-web:development\n' ;;
  "image inspect"*) ref=$(echo "$*" | awk '{print $NF}' | tr '/:' '__'); cat "/state/id_$ref" 2>/dev/null || exit 1 ;;
  *" pull "*)
    [ -f /state/pull_fails ] && { echo "pull access denied" >&2; exit 1; }
    [ -f /state/new_web ] && echo sha256:new-web > /state/id_ghcr.io_facabore_hearth-web_development
    exit 0 ;;
  *" ps -q app"*) [ -f /state/running ] && echo c0ffee ;;
  *" up -d"*) [ -f /state/up_fails ] && exit 1; exit 0 ;;
esac
`;

describe("scripts/staging-update.sh (ADR 0008)", () => {
  let state: string;
  afterEach(() => rmSync(state, { recursive: true, force: true }));

  /** Runs the script in an Alpine shell, with the stub first on PATH and the given files in the state directory. */
  const run = (files: Record<string, string>) => {
    state = mkdtempSync(join(tmpdir(), "hearth-staging-"));
    writeFileSync(join(state, "docker"), STUB, { mode: 0o755 });
    const ids = {
      "id_ghcr.io_facabore_hearth_development": "sha256:app",
      "id_ghcr.io_facabore_hearth-migrator_development": "sha256:migrator",
      "id_ghcr.io_facabore_hearth-web_development": "sha256:web",
    };
    for (const [name, content] of Object.entries({ ...ids, ...files }))
      writeFileSync(join(state, name), `${content}\n`);
    const result = docker(
      "run",
      "--rm",
      "-v",
      `${resolve("scripts")}:/hearth:ro`,
      "-v",
      `${state}:/state`,
      "-e",
      "STACK_DIR=/state",
      "postgres:18.6-alpine",
      "sh",
      "-c",
      "cp /state/docker /usr/local/bin/docker && chmod +x /usr/local/bin/docker && sh /hearth/staging-update.sh",
    );
    const calls = readFileSync(join(state, "calls"), "utf8").trim().split("\n");
    return { ...result, calls, ups: calls.filter((c) => c.includes(" up -d")) };
  };

  it("does nothing while the running stack's images are the newest", () => {
    const result = run({ running: "" });
    expect(result.status).toBe(0);
    expect(result.ups).toEqual([]);
    expect(logEvents(result.stdout)).toEqual([]);
  });

  it("brings the stack up, migrations first, once a pull changed an image, and says which", () => {
    const result = run({ running: "", new_web: "" });
    expect(result.status).toBe(0);
    expect(result.ups).toEqual([
      expect.stringMatching(/compose -f compose.yaml -f compose.staging.yaml up -d/),
    ]);
    expect(logEvents(result.stdout)).toEqual([
      expect.objectContaining({ level: "info", event: "staging_updated", job: "staging-update" }),
    ]);
  });

  it("brings up a stack that is not running even when no image changed", () => {
    const result = run({});
    expect(result.status).toBe(0);
    expect(result.ups).toHaveLength(1);
    expect(logEvents(result.stdout)).toEqual([expect.objectContaining({ event: "staging_updated" })]);
  });

  it("never deploys after a failed pull, and logs the step that failed", () => {
    const result = run({ running: "", new_web: "", pull_fails: "" });
    expect(result.status).not.toBe(0);
    expect(result.ups).toEqual([]);
    expect(logEvents(result.stdout)).toEqual([
      expect.objectContaining({ level: "error", event: "staging_update_failed", step: "pull" }),
    ]);
  });
});
