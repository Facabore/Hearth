import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cruise, type ICruiseResult } from "dependency-cruiser";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const config = require("../../.dependency-cruiser.cjs") as {
  forbidden: { name: string; comment: string }[];
  options: { doNotFollow: { path: string } };
};
const fixtures = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");

async function violations(fixture: string) {
  const result = await cruise(["src"], {
    baseDir: join(fixtures, fixture),
    validate: true,
    ruleSet: { forbidden: config.forbidden } as never,
    tsPreCompilationDeps: true,
    doNotFollow: config.options.doNotFollow,
  });
  const output = result.output as ICruiseResult;
  return output.summary.violations.map((v) => ({ rule: v.rule.name, from: v.from, to: v.to }));
}

describe("architecture boundaries", () => {
  it("fails when a domain file imports the ORM", async () => {
    const found = await violations("domain-imports-orm");
    expect(found.map((v) => v.rule)).toContain("domain-must-be-pure");
  });

  it("fails when a domain file imports Next.js", async () => {
    const found = await violations("domain-imports-next");
    expect(found.map((v) => v.rule)).toContain("domain-must-be-pure");
  });

  it("fails when a module reaches into another module's internals", async () => {
    const found = await violations("cross-module");
    expect(found.map((v) => v.rule)).toContain("modules-only-through-public-application-api");
    const rule = config.forbidden.find((r) => r.name === "modules-only-through-public-application-api");
    expect(rule?.comment).toContain("may only import another module's public application API");
  });

  it("lets a table file reference another module's table file for foreign keys", async () => {
    expect(await violations("schema-foreign-key")).toEqual([]);
  });

  it("forbids a table file from reaching anything else in another module", async () => {
    const found = await violations("schema-reaches-repository");
    expect(found.map((v) => v.rule)).toContain("schemas-only-reference-schemas");
  });

  it.each([
    ["kernel-imports-node", "kernel-must-be-pure"],
    ["application-imports-infrastructure", "application-must-not-depend-on-adapters"],
    ["shared-imports-module", "shared-must-not-depend-on-modules"],
    ["circular", "no-circular"],
    ["web-imports-composition", "ui-talks-only-to-the-api"],
    ["ui-imports-application", "ui-talks-only-to-the-api"],
    ["ui-imports-kernel-barrel", "ui-talks-only-to-the-api"],
    ["ui-crosses-module-ui", "ui-modules-only-through-public-ui-api"],
  ])("flags the %s fixture with %s", async (fixture, rule) => {
    expect((await violations(fixture)).map((v) => v.rule)).toContain(rule);
  });

  it("passes allowed dependency directions", async () => {
    expect(await violations("allowed")).toEqual([]);
  });
});
