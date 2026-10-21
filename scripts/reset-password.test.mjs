import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const run = (args, env = {}) =>
  spawnSync(process.execPath, ["scripts/reset-password.mjs", ...args], {
    encoding: "utf8",
    input: "",
    env: { PATH: process.env.PATH, ...env },
  });

describe("scripts/reset-password.mjs command line", () => {
  it("exits 1 with the wording of migrate.mjs when DATABASE_URL is missing", () => {
    const result = run(["ana@example.com"]);
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe("Missing or invalid environment variables: DATABASE_URL");
    expect(result.stdout).toBe("");
  });

  it.each([[[]], [["ana@example.com", "extra"]]])(
    "exits 2 with a usage line unless it gets exactly one argument (%j)",
    (args) => {
      const result = run(args, { DATABASE_URL: "postgres://unused@127.0.0.1:1/unused" });
      expect(result.status).toBe(2);
      expect(result.stderr.trim()).toMatch(/^Usage: node scripts\/reset-password\.mjs <email>/);
      expect(result.stdout).toBe("");
    },
  );
});

describe("the migrator image", () => {
  it("copies the reset script next to migrate.mjs", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const stage = dockerfile.slice(dockerfile.indexOf("AS migrator"), dockerfile.indexOf("AS runner"));
    expect(stage).toContain("COPY scripts/reset-password.mjs ./scripts/reset-password.mjs");
  });
});
