import { describe, expect, it } from "vitest";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { capacityOf, checkedCapacities, shareOfTotal, totalCapacity } from "./capacity";

const MEMBERS = ["member-ana", "member-juan", "member-pedro"];
const cop = (pesos: number) => money(BigInt(pesos) * 100n);

describe("member capacities (HU-E6-02)", () => {
  it("defines the proportional ratio Ana 40.00 % and Juan 60.00 % of 4,000,000 COP (golden)", () => {
    const capacities = unwrap(
      checkedCapacities(
        [
          { memberId: "member-ana", amount: cop(1_600_000) },
          { memberId: "member-juan", amount: cop(2_400_000) },
        ],
        MEMBERS,
        "COP",
      ),
    );
    expect(capacities).toEqual([
      { memberId: "member-ana", amount: 160_000_000n },
      { memberId: "member-juan", amount: 240_000_000n },
    ]);
    const total = totalCapacity(capacities, MEMBERS);
    expect(total).toBe(400_000_000n);
    expect([shareOfTotal(160_000_000n, total), shareOfTotal(240_000_000n, total)]).toEqual([4000, 6000]);
  });

  it("counts a member without an explicit capacity, the guest Pedro here, as 0 COP", () => {
    const capacities = [{ memberId: "member-ana", amount: 160_000_000n }];
    expect(capacityOf(capacities, "member-pedro")).toBe(0n);
    expect(totalCapacity(capacities, MEMBERS)).toBe(160_000_000n);
  });

  it("lets a guest hold capacity like anyone (D15)", () => {
    const pedro = checkedCapacities([{ memberId: "member-pedro", amount: cop(300_000) }], MEMBERS, "COP");
    expect(unwrap(pedro)).toEqual([{ memberId: "member-pedro", amount: 30_000_000n }]);
  });

  it("accepts a zero capacity and counts it as 0 in the total", () => {
    const capacities = unwrap(
      checkedCapacities(
        [
          { memberId: "member-ana", amount: cop(1_600_000) },
          { memberId: "member-juan", amount: cop(0) },
        ],
        MEMBERS,
        "COP",
      ),
    );
    expect(capacities).toEqual([
      { memberId: "member-ana", amount: 160_000_000n },
      { memberId: "member-juan", amount: 0n },
    ]);
    expect(totalCapacity(capacities, MEMBERS)).toBe(160_000_000n);
    expect(shareOfTotal(capacityOf(capacities, "member-juan"), 160_000_000n)).toBe(0);
  });

  it("rejects a negative capacity", () => {
    const negative = checkedCapacities([{ memberId: "member-juan", amount: cop(-100_000) }], MEMBERS, "COP");
    expect(negative).toEqual({
      ok: false,
      error: { code: "InvalidCapacity", details: { reason: "negative" } },
    });
  });

  it("rejects a capacity for Marta, who is neither a registered member nor a guest", () => {
    const marta = checkedCapacities([{ memberId: "member-marta", amount: cop(100_000) }], MEMBERS, "COP");
    expect(codeOf(marta)).toBe("NotASpaceMember");
  });

  it("rejects a member listed twice and an amount in another currency", () => {
    const twice = checkedCapacities(
      [
        { memberId: "member-ana", amount: cop(1) },
        { memberId: "member-ana", amount: cop(2) },
      ],
      MEMBERS,
      "COP",
    );
    expect(twice).toEqual({
      ok: false,
      error: { code: "InvalidCapacity", details: { reason: "duplicateMember" } },
    });
    const dollars = checkedCapacities(
      [{ memberId: "member-ana", amount: money(100n, "USD") }],
      MEMBERS,
      "COP",
    );
    expect(codeOf(dollars)).toBe("CurrencyMismatch");
  });

  it("counts only current members: a member who left no longer adds to the total (Review Focus 2)", () => {
    const capacities = [
      { memberId: "member-ana", amount: 160_000_000n },
      { memberId: "member-luis", amount: 50_000_000n },
    ];
    expect(totalCapacity(capacities, ["member-ana"])).toBe(160_000_000n);
  });

  it("rounds shares half up to basis points, and has none without capacity", () => {
    expect(shareOfTotal(147_000_000n, 400_000_000n)).toBe(3675);
    expect(shareOfTotal(1n, 3n)).toBe(3333);
    expect(shareOfTotal(2n, 3n)).toBe(6667);
    expect(shareOfTotal(0n, 0n)).toBeNull();
  });

  it("rounds an exact tie up: 0.5 and 1.5 basis points become 1 and 2", () => {
    expect(shareOfTotal(1n, 20_000n)).toBe(1);
    expect(shareOfTotal(3n, 20_000n)).toBe(2);
  });
});
