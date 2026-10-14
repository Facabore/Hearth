import { describe, expect, it } from "vitest";
import { netBalances, netOf, type MemberTotals } from "./balances";

const totals = (
  memberId: string,
  paid: bigint,
  consumed: bigint,
  settledOut = 0n,
  settledIn = 0n,
): MemberTotals => ({
  memberId,
  paid,
  consumed,
  settledOut,
  settledIn,
});

describe("balance rule (E5)", () => {
  it("nets payments and settlements paid against shares consumed and settlements received", () => {
    expect(netOf(totals("member-ana", 300n, 150n, 20n, 50n))).toBe(120n);
  });

  it("lists every current member in join order, with 0 when nothing moved their balance", () => {
    const balances = netBalances(
      ["member-ana", "member-juan", "member-pedro"],
      [totals("member-juan", 0n, 150n), totals("member-ana", 300n, 150n)],
    );
    expect(balances).toEqual([
      { memberId: "member-ana", net: 150n },
      { memberId: "member-juan", net: -150n },
      { memberId: "member-pedro", net: 0n },
    ]);
  });

  it("keeps members the totals mention who are no longer current, so the balances still sum to zero", () => {
    const balances = netBalances(
      ["member-ana"],
      [totals("member-ana", 300n, 150n), totals("member-zed", 0n, 150n)],
    );
    expect(balances).toEqual([
      { memberId: "member-ana", net: 150n },
      { memberId: "member-zed", net: -150n },
    ]);
    expect(balances.reduce((sum, b) => sum + b.net, 0n)).toBe(0n);
  });
});
