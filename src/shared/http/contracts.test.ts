import { describe, expect, it } from "vitest";
import { Money, type LocalDate } from "@/shared/kernel";
import {
  basisPointsOf,
  percentOf,
  PercentSchema,
  MoneySchema,
  moneyFromDto,
  moneyToDto,
  optionalLocalDate,
  periodDto,
  ProblemSchema,
  problems,
} from "./contracts";

describe("MoneySchema", () => {
  it("serializes Money as a minor-units string", () => {
    const money = Money.fromMajor("1600000", "COP");
    if (!money.ok) throw new Error(money.error.code);
    expect(moneyToDto(money.value)).toEqual({ amount: "160000000", currency: "COP" });
  });

  it("parses a valid DTO back into Money", () => {
    const parsed = moneyFromDto({ amount: "-160000000", currency: "COP" });
    expect(parsed.ok && parsed.value.minor).toBe(-160000000n);
  });

  it("rejects an unknown currency when mapping to Money", () => {
    const parsed = moneyFromDto({ amount: "5", currency: "XXX" });
    expect(!parsed.ok && parsed.error.code).toBe("UnknownCurrency");
  });

  it.each([
    [{ amount: 160000000, currency: "COP" }, "amount"],
    [{ amount: "+5", currency: "COP" }, "amount"],
    [{ amount: " 5", currency: "COP" }, "amount"],
    [{ amount: "5.00", currency: "COP" }, "amount"],
    [{ amount: "", currency: "COP" }, "amount"],
    [{ amount: "9223372036854775808", currency: "COP" }, "amount"],
    [{ amount: "-9223372036854775809", currency: "COP" }, "amount"],
    [{ amount: "5", currency: "cop" }, "currency"],
  ])("rejects %j at path %s with a single issue", (input, path) => {
    const result = MoneySchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0]!.path).toEqual([path]);
    }
  });

  it("accepts the PostgreSQL bigint bounds", () => {
    expect(MoneySchema.safeParse({ amount: "9223372036854775807", currency: "COP" }).success).toBe(true);
    expect(MoneySchema.safeParse({ amount: "-9223372036854775808", currency: "COP" }).success).toBe(true);
  });
});

describe("problems", () => {
  it("builds problem+json responses keyed by status", () => {
    expect(problems({ "404": "SpaceNotFound" })).toEqual({
      "404": {
        description: "SpaceNotFound",
        content: { "application/problem+json": { schema: ProblemSchema } },
      },
    });
  });
});

describe("optionalLocalDate", () => {
  it("keeps an absent date absent and validates present ones", () => {
    expect(optionalLocalDate(undefined)).toEqual({ ok: true, value: undefined });
    expect(optionalLocalDate("2026-10-31")).toEqual({ ok: true, value: "2026-10-31" });
    const impossible = optionalLocalDate("2026-02-30");
    expect(!impossible.ok && impossible.error.code).toBe("InvalidDate");
  });
});

describe("periodDto", () => {
  it("serializes a period with explicit start and end dates", () => {
    expect(
      periodDto({ start: "2026-10-25" as LocalDate, end: "2026-11-24" as LocalDate, label: "2026-11" }),
    ).toEqual({ label: "2026-11", startDate: "2026-10-25", endDate: "2026-11-24" });
  });
});

describe("percentages (HU-E4-08, HU-E6-03, HU-E6-05)", () => {
  it("parses percentages with at most two decimals into basis points", () => {
    expect(["40", "33.33", "0.5", "100"].map(basisPointsOf)).toEqual([4000, 3333, 50, 10_000]);
    expect(["40", "33.33", "100"].every((p) => PercentSchema.safeParse(p).success)).toBe(true);
    expect(["40.123", "-1", "4e1", ""].some((p) => PercentSchema.safeParse(p).success)).toBe(false);
  });

  it("prints basis points with exactly two decimals", () => {
    expect([4000, 3675, 1825, 5, 11_111].map(percentOf)).toEqual([
      "40.00",
      "36.75",
      "18.25",
      "0.05",
      "111.11",
    ]);
  });
});
