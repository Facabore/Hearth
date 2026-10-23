import { describe, expect, it } from "vitest";
import { Money } from "@/shared/kernel";
import { cop } from "../../../../../tests/support/ui/dto";
import { planLineDto } from "../../../../../tests/support/ui/plan-dto";
import { currencyOf } from "@/shared/ui/format/currencies";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { allocate, allocationBodyOf, allocationChanged, allocationDraftOf, previewOf } from "./allocation";

const free = {
  planned: "73000000",
  currency: "COP",
  members: [
    { memberId: "m-ana", capacity: "160000000" },
    { memberId: "m-juan", capacity: "240000000" },
  ],
  numberFormat: "DOT_COMMA" as const,
};

describe("allocation preview (HU-E9-08, ruling P211)", () => {
  it("allocates exactly as the kernel's Money.allocate does", () => {
    const cases: [bigint, bigint[], string][] = [
      [73_000_000n, [4_200n, 5_800n], "COP"],
      [100_000n, [1n, 1n, 1n], "COP"],
      [100_001n, [1n, 1n, 1n], "USD"],
      [147_000_000n, [160_000_000n, 240_000_000n], "COP"],
      [73_000_000n, [3_333n, 3_333n, 3_334n], "COP"],
    ];
    for (const [total, weights, currency] of cases) {
      const money = Money.ofMinor(total, currency);
      if (!money.ok) throw new Error(currency);
      const kernel = money.value.allocate(weights);
      if (!kernel.ok) throw new Error("allocate");
      expect(allocate(total, weights, currencyOf(currency).roundingUnit)).toEqual(
        kernel.value.map((m) => m.minor),
      );
    }
  });

  it("previews Free at 42 % / 58 % as 306.600 and 423.400, and a sum of 99 % as invalid", () => {
    expect(previewOf({ rule: "PERCENT", values: { "m-ana": "42", "m-juan": "58" } }, free)).toEqual({
      kind: "assigned",
      amounts: { "m-ana": "30660000", "m-juan": "42340000" },
    });
    expect(previewOf({ rule: "PERCENT", values: { "m-ana": "42", "m-juan": "57" } }, free)).toEqual({
      kind: "invalid",
      sum: "99.00",
      unit: "percent",
    });
  });

  it("follows capacities, checks fixed amounts to the peso, and shows nothing per member for NONE", () => {
    expect(previewOf({ rule: "PROPORTIONAL", values: {} }, free)).toEqual({
      kind: "assigned",
      amounts: { "m-ana": "29200000", "m-juan": "43800000" },
    });
    expect(previewOf({ rule: "FIXED", values: { "m-ana": "300.000", "m-juan": "430.001" } }, free)).toEqual({
      kind: "invalid",
      sum: "73000100",
      unit: "money",
    });
    expect(previewOf({ rule: "NONE", values: {} }, free)).toEqual({ kind: "none" });
    expect(previewOf({ rule: "PROPORTIONAL", values: {} }, { ...free, members: [] })).toEqual({
      kind: "noCapacity",
    });
    expect(previewOf({ rule: "PERCENT", values: { "m-ana": "cuarenta" } }, free)).toEqual({
      kind: "unreadable",
      memberId: "m-ana",
    });
  });

  it("sends the members with a value, and knows when the stored allocation already says it", () => {
    expect(
      allocationBodyOf(
        { rule: "PERCENT", values: { "m-ana": "42", "m-juan": "58" } },
        ["m-ana", "m-juan"],
        "COP",
        "DOT_COMMA",
      ),
    ).toEqual({
      rule: "PERCENT",
      members: [
        { memberId: "m-ana", percent: "42" },
        { memberId: "m-juan", percent: "58" },
      ],
    });
    expect(
      allocationBodyOf(
        { rule: "FIXED", values: { "m-ana": "300.000", "m-juan": "430.000" } },
        ["m-ana", "m-juan"],
        "COP",
        "DOT_COMMA",
      ),
    ).toEqual({
      rule: "FIXED",
      members: [
        { memberId: "m-ana", amount: { amount: "30000000", currency: "COP" } },
        { memberId: "m-juan", amount: { amount: "43000000", currency: "COP" } },
      ],
    });
    expect(
      allocationBodyOf(
        { rule: "PERCENT", values: { "m-ana": "42", "m-juan": "57" } },
        ["m-ana", "m-juan"],
        "COP",
        "DOT_COMMA",
      ),
    ).toBeNull();
    const home = planLineDto();
    expect(allocationDraftOf(home, BUILT_IN_FORMATS)).toEqual({ rule: "PROPORTIONAL", values: {} });
    expect(allocationChanged(home, { rule: "PROPORTIONAL" })).toBe(false);
    expect(allocationChanged(home, { rule: "NONE" })).toBe(true);
    expect(allocationChanged(null, { rule: "PROPORTIONAL" })).toBe(false);
  });

  it("reads a stored percentage or fixed allocation back as the person would type it, and compares by value", () => {
    const member = (memberId: string, rest: { percent?: string; amount?: ReturnType<typeof cop> }) => ({
      memberId,
      percent: rest.percent ?? null,
      amount: rest.amount ?? null,
      assigned: cop(0),
    });
    const percent = planLineDto({
      plannedAmount: cop(730_000),
      allocation: {
        rule: "PERCENT",
        members: [member("m-ana", { percent: "42.00" }), member("m-juan", { percent: "58.00" })],
        error: null,
      },
    });
    const fixed = planLineDto({
      plannedAmount: cop(730_000),
      allocation: {
        rule: "FIXED",
        members: [member("m-ana", { amount: cop(300_000) }), member("m-juan", { amount: cop(430_000) })],
        error: null,
      },
    });
    expect(allocationDraftOf(percent, BUILT_IN_FORMATS)).toEqual({
      rule: "PERCENT",
      values: { "m-ana": "42", "m-juan": "58" },
    });
    expect(allocationDraftOf(fixed, BUILT_IN_FORMATS)).toEqual({
      rule: "FIXED",
      values: { "m-ana": "300.000", "m-juan": "430.000" },
    });

    const same = {
      rule: "PERCENT" as const,
      members: [
        { memberId: "m-ana", percent: "42" },
        { memberId: "m-juan", percent: "58" },
      ],
    };
    expect(allocationChanged(percent, same)).toBe(false);
    expect(
      allocationChanged(percent, {
        rule: "PERCENT",
        members: [
          { memberId: "m-ana", percent: "43" },
          { memberId: "m-juan", percent: "57" },
        ],
      }),
    ).toBe(true);
    expect(
      allocationChanged(percent, { rule: "PERCENT", members: [{ memberId: "m-ana", percent: "100" }] }),
    ).toBe(true);
    expect(allocationChanged(percent, { rule: "NONE" })).toBe(true);
    expect(
      allocationChanged(fixed, {
        rule: "FIXED",
        members: [
          { memberId: "m-ana", amount: cop(300_000) },
          { memberId: "m-juan", amount: cop(430_000) },
        ],
      }),
    ).toBe(false);
    expect(
      allocationChanged(fixed, {
        rule: "FIXED",
        members: [
          { memberId: "m-ana", amount: cop(300_001) },
          { memberId: "m-juan", amount: cop(429_999) },
        ],
      }),
    ).toBe(true);
  });
});
