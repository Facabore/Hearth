import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findUnpinned } from "./check-pinned.mjs";

describe("findUnpinned", () => {
  it("accepts exact versions, including prereleases", () => {
    expect(findUnpinned({ dependencies: { next: "16.4.0" }, devDependencies: { x: "1.0.0-rc.4" } })).toEqual(
      [],
    );
  });

  it.each(["^3.0.0", "~3.0.0", "*", "latest", ">=1.0.0", "3.x", "next"])("rejects the range %s", (spec) => {
    expect(findUnpinned({ dependencies: { zod: spec } })).toEqual([
      { field: "dependencies", name: "zod", spec },
    ]);
  });

  it("exits non-zero and names the unpinned package", () => {
    const dir = mkdtempSync(join(tmpdir(), "pinned-"));
    const file = join(dir, "package.json");
    writeFileSync(file, JSON.stringify({ dependencies: { zod: "^3.0.0" } }));
    let output = "";
    let status = 0;
    try {
      execFileSync(process.execPath, ["scripts/check-pinned.mjs", file], { encoding: "utf8", stdio: "pipe" });
    } catch (error) {
      status = error.status;
      output = String(error.stderr);
    }
    expect(status).not.toBe(0);
    expect(output).toContain("zod is not pinned to an exact version");
  });
});
