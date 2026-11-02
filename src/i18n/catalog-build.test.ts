import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOG_FILE, CORE_CATALOG_FILE } from "../../vite.spa.config";

describe("the build's catalogs (ruling P276)", () => {
  const messages = "src/i18n/messages";
  const catalogs = readdirSync(messages, { recursive: true })
    .map((file) => String(file).replaceAll("\\", "/"))
    .filter((file) => file.endsWith(".json"))
    .map((file) => join(process.cwd(), messages, file));

  it("compiles every catalog, the core and each area, so none reaches the browser as raw ICU", () => {
    expect(catalogs.length).toBeGreaterThan(2);
    for (const file of catalogs) expect(CATALOG_FILE.test(file), file).toBe(true);
  });

  it("preloads only a language's core catalog from the HTML", () => {
    expect(catalogs.filter((file) => CORE_CATALOG_FILE.test(file)).map((file) => file.slice(-7))).toEqual([
      "en.json",
      "es.json",
    ]);
  });
});
