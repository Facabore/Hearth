import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Ruling P121: the calls that format with a locale's defaults, and next-intl's formatter, which does too. */
const LOCALE_FORMATTING =
  /\b(toLocaleString|toLocaleDateString|toLocaleTimeString|Intl\.(NumberFormat|DateTimeFormat|RelativeTimeFormat|ListFormat)|useFormatter|getFormatter)\b/;
const ROOTS = ["src/app/(web)", "src/i18n", "src/shared/ui", "src/modules"];
const ALLOWED = /^src[\\/]shared[\\/]ui[\\/]format[\\/]/;

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });

export const offendersIn = (paths: readonly string[], read: (path: string) => string): string[] =>
  paths.filter(
    (p) =>
      /\.(ts|tsx)$/.test(p) &&
      !/\.test\.tsx?$/.test(p) &&
      !ALLOWED.test(p) &&
      LOCALE_FORMATTING.test(read(p)),
  );

describe("UI formatting (HU-E9-02)", () => {
  it("flags a component that formats with the locale's defaults", () => {
    const sources: Record<string, string> = {
      "src/modules/ledger/ui/row.tsx": "amount.toLocaleString('es-CO')",
      "src/shared/ui/format/formatters.ts": "new Intl.DateTimeFormat('en-US', { timeZone })",
      "src/modules/ledger/ui/ok.tsx": "formatMoney(money, formats)",
    };
    expect(offendersIn(Object.keys(sources), (p) => sources[p]!)).toEqual(["src/modules/ledger/ui/row.tsx"]);
  });

  it("finds no UI file outside src/shared/ui/format that formats with Intl or toLocale*", () => {
    const uiFiles = ROOTS.flatMap((root) => {
      try {
        return files(root);
      } catch {
        return [];
      }
    }).filter((p) => !p.startsWith(join("src", "modules")) || /[\\/]ui[\\/]/.test(p));
    expect(offendersIn(uiFiles, (p) => readFileSync(p, "utf8"))).toEqual([]);
  });
});
