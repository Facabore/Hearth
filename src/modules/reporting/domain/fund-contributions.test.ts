import { describe, expect, it } from "vitest";
import { fundContributions } from "./fund-contributions";

const pesos = (n: number) => BigInt(n) * 100n;
const rent = {
  members: [
    { memberId: "ana", assigned: pesos(480_000) },
    { memberId: "juan", assigned: pesos(720_000) },
  ],
};

describe("fund contributions (HU-E7-03, spec 5.4)", () => {
  it("compares each member's expected and actual contributions (@golden)", () => {
    const actual = [
      { memberId: "ana", amount: pesos(480_000) },
      { memberId: "juan", amount: pesos(500_000) },
    ];
    expect(fundContributions(["ana", "juan"], [rent], actual)).toEqual([
      { memberId: "ana", expected: pesos(480_000), actual: pesos(480_000), difference: 0n },
      { memberId: "juan", expected: pesos(720_000), actual: pesos(500_000), difference: -pesos(220_000) },
    ]);
  });

  it("expects 0 from every member of a plan without SHARED_FUND lines", () => {
    expect(fundContributions(["ana", "juan"], [], []).map((c) => [c.expected, c.actual])).toEqual([
      [0n, 0n],
      [0n, 0n],
    ]);
  });

  it("sums every fund line and counts an invalid allocation as nothing assigned", () => {
    const water = {
      members: [
        { memberId: "ana", assigned: pesos(40_000) },
        { memberId: "juan", assigned: pesos(60_000) },
      ],
    };
    const invalid = {
      members: [
        { memberId: "ana", assigned: null },
        { memberId: "juan", assigned: null },
      ],
    };
    expect(fundContributions(["ana", "juan"], [rent, water, invalid], []).map((c) => c.expected)).toEqual([
      pesos(520_000),
      pesos(780_000),
    ]);
  });

  it("lists only the members it is given, so a former member's contribution counts for nobody (ruling P7)", () => {
    const actual = [
      { memberId: "luis", amount: pesos(100_000) },
      { memberId: "ana", amount: pesos(200_000) },
      { memberId: "ana", amount: pesos(280_000) },
    ];
    expect(fundContributions(["ana"], [rent], actual)).toEqual([
      { memberId: "ana", expected: pesos(480_000), actual: pesos(480_000), difference: 0n },
    ]);
  });
});
