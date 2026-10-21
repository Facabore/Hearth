import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PALETTE } from "@/shared/kernel/style";

describe("palette tokens (ruling P135)", () => {
  it("defines a tint and an ink for every palette key, in light and in dark", () => {
    const css = readFileSync("src/app/(web)/globals.css", "utf8");
    const [light = "", dark = ""] = css.split("/* dark palette */");
    for (const key of PALETTE.map((k) => k.toLowerCase())) {
      expect(light).toContain(`--pal-${key}-tint:`);
      expect(light).toContain(`--pal-${key}-ink:`);
      expect(dark).toContain(`--pal-${key}-tint:`);
      expect(dark).toContain(`--pal-${key}-ink:`);
    }
  });
});
