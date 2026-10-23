import { describe, expect, it } from "vitest";
import { periodByLabel, type LocalDate, type PeriodPolicy, type StoredPeriod } from "@/shared/kernel";
import { unwrap } from "../../../../tests/support/fakes";
import { changeFrom, distinctLabels, periodsEndingWith, tracedLines } from "./trend";

const pesos = (n: number) => BigInt(n) * 100n;
const labels = (policy: PeriodPolicy, end: string, count: number) =>
  periodsEndingWith(policy, [], unwrap(periodByLabel(policy, [], end)), count).map((p) => p.label);

describe("trend windows (HU-E7-05, spec 5.3)", () => {
  it("ends with the given period and steps back through the previous periods of the policy, oldest first", () => {
    expect(labels({ kind: "MONTHLY", day: 1 }, "2026-11", 6)).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    expect(labels({ kind: "MONTHLY", day: 25 }, "2026-12", 2)).toEqual(["2026-11", "2026-12"]);
  });

  it("compares H2 with H1 of the same month and H1 with the previous month's H2", () => {
    expect(labels({ kind: "SEMI_MONTHLY", day1: 1, day2: 16 }, "2026-11 H2", 3)).toEqual([
      "2026-10 H2",
      "2026-11 H1",
      "2026-11 H2",
    ]);
  });

  it("follows a period's stored boundaries (D10)", () => {
    const policy: PeriodPolicy = { kind: "MONTHLY", day: 1 };
    const stored: StoredPeriod[] = [
      { start: "2026-10-05" as LocalDate, end: "2026-11-04" as LocalDate, label: "2026-10" },
    ];
    const end = unwrap(periodByLabel(policy, stored, "2026-11"));
    expect(periodsEndingWith(policy, stored, end, 2)).toEqual([
      { start: "2026-10-05", end: "2026-11-04", label: "2026-10" },
      { start: "2026-11-05", end: "2026-11-30", label: "2026-11" },
    ]);
  });
});

describe("distinct labels in a window (#132)", () => {
  const period = (start: string, end: string, label: string): StoredPeriod => ({
    start: start as LocalDate,
    end: end as LocalDate,
    label,
  });

  it("leaves a window whose labels differ exactly as it is", () => {
    const window = [
      period("2026-10-01", "2026-10-31", "2026-10"),
      period("2026-11-01", "2026-11-30", "2026-11"),
    ];
    expect(distinctLabels(window, [])).toEqual(window);
  });

  it("keeps the stored period's label and writes the stub it shares it with apart", () => {
    const stored = [period("2026-10-05", "2026-11-04", "2026-10")];
    const stub = period("2026-10-01", "2026-10-04", "2026-10");
    expect(distinctLabels([stub, stored[0]!], stored)).toEqual([
      { ...stub, label: "2026-10 (2026-10-01..2026-10-04)" },
      stored[0],
    ]);
  });

  it("writes both stubs around a stored period apart and keeps the stored label", () => {
    const stored = [period("2026-10-10", "2026-10-20", "2026-10")];
    const window = [
      period("2026-10-01", "2026-10-09", "2026-10"),
      stored[0]!,
      period("2026-10-21", "2026-10-31", "2026-10"),
    ];
    expect(distinctLabels(window, stored).map((p) => p.label)).toEqual([
      "2026-10 (2026-10-01..2026-10-09)",
      "2026-10",
      "2026-10 (2026-10-21..2026-10-31)",
    ]);
  });

  it("keeps the earliest label when none of the periods sharing it is stored", () => {
    const window = [
      period("2026-10-01", "2026-10-09", "2026-10"),
      period("2026-10-21", "2026-10-31", "2026-10"),
    ];
    expect(distinctLabels(window, []).map((p) => p.label)).toEqual([
      "2026-10",
      "2026-10 (2026-10-21..2026-10-31)",
    ]);
  });
});

describe("period-over-period change (HU-E7-05)", () => {
  it("gives the change and its percentage with two decimals", () => {
    expect(changeFrom(pesos(1_350_000), pesos(1_300_000))).toEqual({
      amount: -pesos(50_000),
      basisPoints: -370,
      status: "DECREASED",
    });
    expect(changeFrom(pesos(400_000), pesos(500_000))).toEqual({
      amount: pesos(100_000),
      basisPoints: 2_500,
      status: "INCREASED",
    });
    expect(changeFrom(pesos(500_000), pesos(450_000))).toMatchObject({ basisPoints: -1_000 });
    expect(changeFrom(pesos(80_000), pesos(80_000))).toEqual({
      amount: 0n,
      basisPoints: 0,
      status: "UNCHANGED",
    });
  });

  it("rounds half away from zero", () => {
    expect(changeFrom(3n, 1n).basisPoints).toBe(-6_667);
    expect(changeFrom(3n, 4n).basisPoints).toBe(3_333);
    expect(changeFrom(20_000n, 20_001n).basisPoints).toBe(1);
    expect(changeFrom(20_000n, 19_999n).basisPoints).toBe(-1);
  });

  it("rounds down just below the half, in both directions, and keeps the status of the real change", () => {
    expect(changeFrom(20_001n, 20_002n)).toEqual({ amount: 1n, basisPoints: 0, status: "INCREASED" });
    expect(changeFrom(20_001n, 20_000n)).toEqual({ amount: -1n, basisPoints: 0, status: "DECREASED" });
  });

  it("measures the change against the size of a negative previous figure", () => {
    expect(changeFrom(-100n, -50n)).toEqual({ amount: 50n, basisPoints: 5_000, status: "INCREASED" });
    expect(changeFrom(-100n, -150n)).toEqual({ amount: -50n, basisPoints: -5_000, status: "DECREASED" });
  });

  it("is -100.00 % when the figure falls to 0, and NEW when it was 0 and stays 0", () => {
    expect(changeFrom(pesos(500), 0n)).toEqual({
      amount: -pesos(500),
      basisPoints: -10_000,
      status: "DECREASED",
    });
    expect(changeFrom(0n, 0n)).toEqual({ amount: null, basisPoints: null, status: "NEW" });
  });

  it("is NEW without a previous figure or when the previous one is 0, with no change and no percentage", () => {
    expect(changeFrom(null, pesos(80_000))).toEqual({ amount: null, basisPoints: null, status: "NEW" });
    expect(changeFrom(0n, pesos(80_000))).toEqual({ amount: null, basisPoints: null, status: "NEW" });
  });
});

describe("line continuity (HU-E7-05, ruling P38)", () => {
  const line = (id: string, name: string, originLineId: string | null = null) => ({ id, name, originLineId });

  it("follows each line back through the line it was copied from, a renamed one included", () => {
    const home = line("home-12", "Home", "house-11");
    const plans = [[line("home-10", "Home")], [line("house-11", "House", "home-10")], [home]];
    expect(tracedLines(plans, home).map((l) => l?.id ?? null)).toEqual(["home-10", "house-11", "home-12"]);
  });

  it("falls back to the same name, case ignored, and across a period without a plan", () => {
    const home = line("home-12", "Home");
    const plans = [[line("home-09", "HOME")], null, [line("home-11", "home")], [home]];
    expect(tracedLines(plans, home).map((l) => l?.id ?? null)).toEqual([
      "home-09",
      null,
      "home-11",
      "home-12",
    ]);
  });

  it("keeps following the name of the line it continued when that line was renamed without an origin link", () => {
    const home = line("home-12", "Home", "house-11");
    const plans = [[line("house-10", "House")], [line("house-11", "House")], [home]];
    expect(tracedLines(plans, home).map((l) => l?.id ?? null)).toEqual(["house-10", "house-11", "home-12"]);
  });

  it("prefers the line it was copied from over an earlier line with its name", () => {
    const a = line("A", "Home", "X");
    const plans = [[line("X", "House"), line("Y", "Home")], [a]];
    expect(tracedLines(plans, a).map((l) => l?.id ?? null)).toEqual(["X", "A"]);
  });

  it("skips a period without a plan and keeps following the line it continued (ruling P98)", () => {
    const home = line("h3", "Home", "h2");
    const plans = [[line("h0", "House")], null, [line("h2", "House")], [home]];
    expect(tracedLines(plans, home).map((l) => l?.id ?? null)).toEqual(["h0", null, "h2", "h3"]);
  });

  it("falls back to the name of the line itself after a plan that holds no match (ruling P98)", () => {
    const home = line("h3", "Home", "h2");
    const plans = [[line("h0", "Home")], [line("other", "Pets")], [line("h2", "House")], [home]];
    expect(tracedLines(plans, home).map((l) => l?.id ?? null)).toEqual(["h0", null, "h2", "h3"]);
  });

  it("never matches by name a line that another line of the later plan continues (ruling P99)", () => {
    const house = line("h", "House");
    const home = line("h2", "Home", "h");
    const fresh = line("n", "House");
    const plans = [[house], [home, fresh]];
    expect(tracedLines(plans, fresh).map((l) => l?.id ?? null)).toEqual([null, "n"]);
    expect(tracedLines(plans, home).map((l) => l?.id ?? null)).toEqual(["h", "h2"]);
  });

  it("lets only the plan the trace came from claim a line by origin (ruling P99)", () => {
    const end = line("e", "House");
    const plans = [[line("a", "House")], [line("b", "House")], [end, line("f", "Other", "a")]];
    expect(tracedLines(plans, end).map((l) => l?.id ?? null)).toEqual(["a", "b", "e"]);
  });

  it("finds nothing for a line that exists only in the last plan", () => {
    const pets = line("pets-11", "Pets");
    expect(tracedLines([[line("home-10", "Home")], [pets]], pets).map((l) => l?.id ?? null)).toEqual([
      null,
      "pets-11",
    ]);
  });
});
