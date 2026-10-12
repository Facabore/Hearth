import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dbCheck = (env = {}) =>
  spawnSync(process.execPath, ["scripts/db-check.mjs"], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

describe("db:check", () => {
  it("passes when the migrations match the Drizzle schema", () => {
    const result = dbCheck();
    expect(result.stdout).toContain("No schema drift");
    expect(result.status).toBe(0);
  }, 60_000);

  it("fails and names the missing migration when the schema drifted, leaving drizzle/ untouched", () => {
    const before = readdirSync("drizzle");
    const result = dbCheck({ DRIZZLE_SCHEMA: "./tests/fixtures/db-drift/*.schema.ts" });
    expect(result.stderr).toContain("Schema drift: a migration is missing");
    expect(result.status).toBe(1);
    expect(readdirSync("drizzle")).toEqual(before);
  }, 60_000);

  it("fails closed when drizzle-kit cannot read the schema", () => {
    const result = dbCheck({ DRIZZLE_SCHEMA: "./tests/fixtures/db-drift/missing/*.schema.ts" });
    expect(result.stderr).toContain("db:check could not verify the schema");
    expect(result.status).toBe(1);
  }, 60_000);
});
