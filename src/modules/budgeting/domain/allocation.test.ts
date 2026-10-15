import { describe, expect, it } from "vitest";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { assignedAmounts, checkedAllocation, type AllocationInput } from "./allocation";
import type { BudgetLine } from "./budget-line";

const MEMBERS = ["member-ana", "member-juan", "member-pedro"];
const cop = (pesos: number) => money(BigInt(pesos) * 100n);
const planned = (pesos: number) => ({ plannedAmount: BigInt(pesos) * 100n });
const line = (rule: BudgetLine["allocationRule"], pesos: number) => ({
  allocationRule: rule,
  ...planned(pesos),
});
// HU-E6-05 Background: capacities Ana 1,600,000 COP and Juan 2,400,000 COP.
const GOLDEN = [
  { memberId: "member-ana", capacity: 160_000_000n },
  { memberId: "member-juan", capacity: 240_000_000n },
];
const formerMember = { ok: false, error: { code: "InvalidAllocation", details: { reason: "formerMember" } } };

describe("checkedAllocation (HU-E6-05)", () => {
  it("stores no values for PROPORTIONAL and NONE", () => {
    expect(unwrap(checkedAllocation({ rule: "PROPORTIONAL" }, planned(1_470_000), MEMBERS, "COP"))).toEqual({
      rule: "PROPORTIONAL",
      values: [],
    });
    expect(unwrap(checkedAllocation({ rule: "NONE" }, planned(730_000), MEMBERS, "COP")).values).toEqual([]);
  });

  it("stores PERCENT 42 % / 58 % as basis points in join order, whatever the request order", () => {
    const free = checkedAllocation(
      {
        rule: "PERCENT",
        members: [
          { memberId: "member-juan", basisPoints: 5800 },
          { memberId: "member-ana", basisPoints: 4200 },
        ],
      },
      planned(730_000),
      MEMBERS,
      "COP",
    );
    expect(unwrap(free)).toEqual({
      rule: "PERCENT",
      values: [
        { memberId: "member-ana", value: 4200n },
        { memberId: "member-juan", value: 5800n },
      ],
    });
  });

  it("stores FIXED amounts that add up to the planned amount", () => {
    const savings = checkedAllocation(
      {
        rule: "FIXED",
        members: [
          { memberId: "member-ana", amount: cop(200_000) },
          { memberId: "member-juan", amount: cop(400_000) },
        ],
      },
      planned(600_000),
      MEMBERS,
      "COP",
    );
    expect(unwrap(savings).values).toEqual([
      { memberId: "member-ana", value: 20_000_000n },
      { memberId: "member-juan", value: 40_000_000n },
    ]);
  });

  it.each<[string, AllocationInput, number, string]>([
    [
      "Free PERCENT 42 % / 57 %",
      {
        rule: "PERCENT" as const,
        members: [
          { memberId: "member-ana", basisPoints: 4200 },
          { memberId: "member-juan", basisPoints: 5700 },
        ],
      },
      730_000,
      "percentNotHundred",
    ],
    [
      "Savings FIXED 200,000 / 350,000 COP",
      {
        rule: "FIXED" as const,
        members: [
          { memberId: "member-ana", amount: cop(200_000) },
          { memberId: "member-juan", amount: cop(350_000) },
        ],
      },
      600_000,
      "fixedNotPlanned",
    ],
  ])("refuses %s: the values must add up", (_line, input, pesos, reason) => {
    expect(checkedAllocation(input, planned(pesos), MEMBERS, "COP")).toEqual({
      ok: false,
      error: { code: "InvalidAllocation", details: { reason } },
    });
  });

  it("refuses non-members, members listed twice, zero values, no members and another currency", () => {
    const percent = (members: { memberId: string; basisPoints: number }[]) =>
      checkedAllocation({ rule: "PERCENT", members }, planned(730_000), MEMBERS, "COP");
    const reason = (reason: string) => ({
      ok: false,
      error: { code: "InvalidAllocation", details: { reason } },
    });
    expect(codeOf(percent([{ memberId: "member-marta", basisPoints: 10_000 }]))).toBe("NotASpaceMember");
    expect(
      percent([
        { memberId: "member-ana", basisPoints: 5000 },
        { memberId: "member-ana", basisPoints: 5000 },
      ]),
    ).toEqual(reason("duplicateMember"));
    expect(
      percent([
        { memberId: "member-ana", basisPoints: 10_000 },
        { memberId: "member-juan", basisPoints: 0 },
      ]),
    ).toEqual(reason("percentNotPositive"));
    expect(percent([])).toEqual(reason("membersRequired"));
    const fixedZero = checkedAllocation(
      {
        rule: "FIXED",
        members: [
          { memberId: "member-ana", amount: cop(600_000) },
          { memberId: "member-juan", amount: cop(0) },
        ],
      },
      planned(600_000),
      MEMBERS,
      "COP",
    );
    expect(fixedZero).toEqual(reason("amountNotPositive"));
    const dollars = checkedAllocation(
      { rule: "FIXED", members: [{ memberId: "member-ana", amount: money(60_000_000n, "USD") }] },
      planned(600_000),
      MEMBERS,
      "COP",
    );
    expect(codeOf(dollars)).toBe("CurrencyMismatch");
  });
});

describe("assignedAmounts (HU-E6-05, spec 5.3)", () => {
  it("assigns Home 588,000 / 882,000 COP in proportion to capacities, the default (golden)", () => {
    expect(unwrap(assignedAmounts(line("PROPORTIONAL", 1_470_000), [], GOLDEN, "COP"))).toEqual([
      { memberId: "member-ana", amount: 58_800_000n },
      { memberId: "member-juan", amount: 88_200_000n },
    ]);
  });

  it("assigns Free 306,600 / 423,400 COP at 42 % / 58 % (golden)", () => {
    const values = [
      { memberId: "member-ana", value: 4200n },
      { memberId: "member-juan", value: 5800n },
    ];
    expect(unwrap(assignedAmounts(line("PERCENT", 730_000), values, GOLDEN, "COP"))).toEqual([
      { memberId: "member-ana", amount: 30_660_000n },
      { memberId: "member-juan", amount: 42_340_000n },
    ]);
  });

  it("assigns FIXED values as they are, and 0 to a member without one", () => {
    const values = [
      { memberId: "member-ana", value: 20_000_000n },
      { memberId: "member-juan", value: 40_000_000n },
    ];
    const withPedro = [...GOLDEN, { memberId: "member-pedro", capacity: 0n }];
    expect(unwrap(assignedAmounts(line("FIXED", 600_000), values, withPedro, "COP"))).toEqual([
      { memberId: "member-ana", amount: 20_000_000n },
      { memberId: "member-juan", amount: 40_000_000n },
      { memberId: "member-pedro", amount: 0n },
    ]);
  });

  it("assigns nobody on a NONE line", () => {
    expect(unwrap(assignedAmounts(line("NONE", 730_000), [], GOLDEN, "COP"))).toBeNull();
  });

  it("flags a PROPORTIONAL line when every capacity is 0", () => {
    const zero = GOLDEN.map((m) => ({ ...m, capacity: 0n }));
    expect(assignedAmounts(line("PROPORTIONAL", 1_470_000), [], zero, "COP")).toEqual({
      ok: false,
      error: { code: "InvalidAllocation", details: { reason: "noCapacity" } },
    });
  });

  it("gives remainders to the earliest-joined members, and Σ assigned is the planned amount (Review Focus 3)", () => {
    const three = MEMBERS.map((memberId) => ({ memberId, capacity: 100_000_000n }));
    const parts = unwrap(assignedAmounts(line("PROPORTIONAL", 100_000), [], three, "COP"))!;
    expect(parts.map((p) => p.amount)).toEqual([3_333_400n, 3_333_300n, 3_333_300n]);
    const subPeso = unwrap(
      assignedAmounts(
        { allocationRule: "PROPORTIONAL", plannedAmount: 10_000_050n },
        [],
        GOLDEN.map((m) => ({ ...m, capacity: 1n })),
        "COP",
      ),
    )!;
    expect(subPeso.map((p) => p.amount)).toEqual([5_000_050n, 5_000_000n]);
  });

  it("never gives a remainder to a member without weight, even the first one to join", () => {
    const pedroFirst = [
      { memberId: "member-pedro", capacity: 0n },
      ...GOLDEN.map((m) => ({ ...m, capacity: 1n })),
    ];
    const parts = unwrap(
      assignedAmounts({ allocationRule: "PROPORTIONAL", plannedAmount: 10_000_050n }, [], pedroFirst, "COP"),
    )!;
    expect(parts).toEqual([
      { memberId: "member-pedro", amount: 0n },
      { memberId: "member-ana", amount: 5_000_050n },
      { memberId: "member-juan", amount: 5_000_000n },
    ]);
  });

  it("flags PERCENT and FIXED lines that name a member who left, until they are allocated again (Review Focus 2)", () => {
    const anaOnly = [{ memberId: "member-ana", capacity: 160_000_000n }];
    const percent = [
      { memberId: "member-ana", value: 4200n },
      { memberId: "member-juan", value: 5800n },
    ];
    expect(assignedAmounts(line("PERCENT", 730_000), percent, anaOnly, "COP")).toEqual(formerMember);
    const fixed = [
      { memberId: "member-ana", value: 20_000_000n },
      { memberId: "member-juan", value: 40_000_000n },
    ];
    expect(assignedAmounts(line("FIXED", 600_000), fixed, anaOnly, "COP")).toEqual(formerMember);
    expect(unwrap(assignedAmounts(line("PROPORTIONAL", 1_470_000), [], anaOnly, "COP"))).toEqual([
      { memberId: "member-ana", amount: 147_000_000n },
    ]);
  });

  it("flags a line that names a member who left even when the current members' values add up (ruling P7)", () => {
    const anaOnly = [{ memberId: "member-ana", capacity: 160_000_000n }];
    // FIXED: the planned amount was edited to what Ana alone holds (200,000 COP).
    const fixed = [
      { memberId: "member-ana", value: 20_000_000n },
      { memberId: "member-juan", value: 40_000_000n },
    ];
    expect(assignedAmounts(line("FIXED", 200_000), fixed, anaOnly, "COP")).toEqual(formerMember);
    // PERCENT: Ana's own row already makes 100 %, yet Juan's row is still there.
    const percent = [
      { memberId: "member-ana", value: 10_000n },
      { memberId: "member-juan", value: 5800n },
    ];
    expect(assignedAmounts(line("PERCENT", 730_000), percent, anaOnly, "COP")).toEqual(formerMember);
  });

  it("flags PERCENT and FIXED lines whose current values do not add up, with the reason", () => {
    const anaOnlyRow = [{ memberId: "member-ana", value: 4200n }];
    expect(assignedAmounts(line("PERCENT", 730_000), anaOnlyRow, GOLDEN, "COP")).toEqual({
      ok: false,
      error: { code: "InvalidAllocation", details: { reason: "percentNotHundred" } },
    });
    const short = [
      { memberId: "member-ana", value: 20_000_000n },
      { memberId: "member-juan", value: 30_000_000n },
    ];
    expect(assignedAmounts(line("FIXED", 600_000), short, GOLDEN, "COP")).toEqual({
      ok: false,
      error: { code: "InvalidAllocation", details: { reason: "fixedNotPlanned" } },
    });
  });
});

describe("assignedAmounts sums (HU-E6-05, Review Focus 3; seeded property check)", () => {
  // mulberry32: a tiny deterministic generator, so a failing case always reproduces.
  const seeded = (seed: number) => {
    let state = seed;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
  };
  const ROUNDING_UNIT = 100n;
  const total = (parts: readonly { amount: bigint }[]) => parts.reduce((a, p) => a + p.amount, 0n);

  it("PROPORTIONAL: Σ assigned is the planned amount, in whole rounding units, and nobody without capacity gets any", () => {
    const next = seeded(20_261_014);
    const below = (limit: number) => Math.floor(next() * limit);
    for (let run = 0; run < 500; run += 1) {
      const count = 1 + below(6);
      // Capacities in minor units, many beyond Number.MAX_SAFE_INTEGER; roughly one in four members has none.
      const members = Array.from({ length: count }, (_, i) => ({
        memberId: `member-${i}`,
        capacity: below(4) === 0 ? 0n : BigInt(below(2 ** 31)) * BigInt(below(2 ** 31)) + 1n,
      }));
      const lucky = below(count);
      if (members.every((m) => m.capacity === 0n)) members[lucky] = { ...members[lucky]!, capacity: 1n };
      const plannedMinor = BigInt(1 + below(5_000_000)) * ROUNDING_UNIT;

      const parts = unwrap(
        assignedAmounts({ allocationRule: "PROPORTIONAL", plannedAmount: plannedMinor }, [], members, "COP"),
      )!;

      expect(parts.map((p) => p.memberId)).toEqual(members.map((m) => m.memberId));
      expect(total(parts)).toBe(plannedMinor);
      expect(parts.every((p) => p.amount % ROUNDING_UNIT === 0n)).toBe(true);
      parts.forEach((p, i) => {
        if (members[i]!.capacity === 0n) expect(p.amount).toBe(0n);
      });
    }
  });

  it("PERCENT: Σ assigned is the planned amount, in whole rounding units, and nobody without a value gets any", () => {
    const next = seeded(20_261_015);
    const below = (limit: number) => Math.floor(next() * limit);
    for (let run = 0; run < 500; run += 1) {
      const count = 1 + below(6);
      const members = Array.from({ length: count }, (_, i) => `member-${i}`);
      // A random non-empty subset of members shares 100 % (10,000 basis points) in positive parts.
      const anchor = below(count);
      const sharing = members.filter((_, i) => i === anchor || below(2) === 0);
      const cuts = new Set<number>();
      while (cuts.size < sharing.length - 1) cuts.add(1 + below(9_999));
      const bounds = [0, ...[...cuts].sort((a, b) => a - b), 10_000];
      const values = sharing.map((memberId, i) => ({ memberId, value: BigInt(bounds[i + 1]! - bounds[i]!) }));
      const plannedMinor = BigInt(1 + below(5_000_000)) * ROUNDING_UNIT;

      const parts = unwrap(
        assignedAmounts(
          { allocationRule: "PERCENT", plannedAmount: plannedMinor },
          values,
          members.map((memberId) => ({ memberId, capacity: 0n })),
          "COP",
        ),
      )!;

      expect(total(parts)).toBe(plannedMinor);
      expect(parts.every((p) => p.amount % ROUNDING_UNIT === 0n)).toBe(true);
      parts.forEach((p) => {
        if (!sharing.includes(p.memberId)) expect(p.amount).toBe(0n);
      });
    }
  });

  it("keeps Σ assigned exact for a planned amount that is not a multiple of the rounding unit", () => {
    const next = seeded(20_261_016);
    const below = (limit: number) => Math.floor(next() * limit);
    for (let run = 0; run < 200; run += 1) {
      // The first member to join often has no capacity: the sub-unit remainder must skip them.
      const members = Array.from({ length: 2 + below(4) }, (_, i) => ({
        memberId: `member-${i}`,
        capacity: i === 0 && below(2) === 0 ? 0n : BigInt(1 + below(1_000_000)),
      }));
      const plannedMinor = BigInt(1 + below(500_000_000));

      const parts = unwrap(
        assignedAmounts({ allocationRule: "PROPORTIONAL", plannedAmount: plannedMinor }, [], members, "COP"),
      )!;

      expect(total(parts)).toBe(plannedMinor);
      parts.forEach((p, i) => {
        if (members[i]!.capacity === 0n) expect(p.amount).toBe(0n);
      });
    }
  });
});
