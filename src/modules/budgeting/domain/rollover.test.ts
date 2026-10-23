import { describe, expect, it } from "vitest";
import type { RolloverMode } from "./budget-line";
import { carriesFromSource, carryOver } from "./rollover";

// HU-E6-09 golden outline: Home plans 1,470,000 COP; spending 1,270,000 COP leaves 200,000 COP available, and
// spending 1,600,000 COP leaves -130,000 COP.
const LEFT = 20_000_000n;
const OVERSPENT = -13_000_000n;

describe("carryOver (HU-E6-09 RolloverCalculator, spec 5.4, ruling P15)", () => {
  it.each<[RolloverMode, bigint | null, bigint]>([
    ["RESET", LEFT, 0n],
    ["RESET", OVERSPENT, 0n],
    ["RESET", 0n, 0n],
    ["RESET", null, 0n],
    ["ROLLOVER", LEFT, LEFT],
    ["ROLLOVER", OVERSPENT, 0n],
    ["ROLLOVER", 0n, 0n],
    ["ROLLOVER", 1n, 1n],
    ["ROLLOVER", -1n, 0n],
    ["ROLLOVER", null, 0n],
    ["ADJUSTED", LEFT, 0n],
    ["ADJUSTED", OVERSPENT, OVERSPENT],
    ["ADJUSTED", 0n, 0n],
    ["ADJUSTED", 1n, 0n],
    ["ADJUSTED", -1n, -1n],
    ["ADJUSTED", null, 0n],
  ])("%s with a previous available of %s carries %s", (mode, previous, carried) => {
    expect(carryOver(mode, previous)).toBe(carried);
  });
});

describe("carriesFromSource (ruling P248 of M6c)", () => {
  it.each<[string, readonly { originLineId: string | null; rolloverMode: RolloverMode }[], boolean]>([
    ["a ROLLOVER line with an origin", [{ originLineId: "o", rolloverMode: "ROLLOVER" }], true],
    ["an ADJUSTED line with an origin", [{ originLineId: "o", rolloverMode: "ADJUSTED" }], true],
    ["a RESET line with an origin", [{ originLineId: "o", rolloverMode: "RESET" }], false],
    ["a ROLLOVER line without an origin", [{ originLineId: null, rolloverMode: "ROLLOVER" }], false],
    ["no lines", [], false],
    [
      "one carrying line among others",
      [
        { originLineId: "o", rolloverMode: "RESET" },
        { originLineId: "p", rolloverMode: "ADJUSTED" },
      ],
      true,
    ],
  ])("%s", (_name, lines, expected) => {
    expect(carriesFromSource(lines)).toBe(expected);
  });
});
