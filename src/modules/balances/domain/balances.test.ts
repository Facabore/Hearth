import { describe, expect, it } from "vitest";
import {
  netBalances,
  netOf,
  simplifyDebts,
  type MemberBalance,
  type MemberTotals,
  type SettlementSuggestion,
} from "./balances";

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

describe("settlement suggestions (HU-E5-03)", () => {
  const nets = (...entries: [string, bigint][]): MemberBalance[] =>
    entries.map(([memberId, net]) => ({ memberId, net }));
  const pays = (payerMemberId: string, receivingMemberId: string, amount: bigint): SettlementSuggestion => ({
    payerMemberId,
    receivingMemberId,
    amount,
  });
  /** What each member pays minus what they receive through the suggestions: −net when they settle everything. */
  const flowOf = (suggestions: readonly SettlementSuggestion[], balances: readonly MemberBalance[]) =>
    balances.map(({ memberId }) => [
      memberId,
      suggestions.reduce(
        (sum, s) =>
          sum +
          (s.payerMemberId === memberId ? s.amount : 0n) -
          (s.receivingMemberId === memberId ? s.amount : 0n),
        0n,
      ),
    ]);

  /** A deterministic 64-bit linear congruential generator over bigint, so no amount ever passes through Number. */
  const seeded = (seed: bigint) => {
    let state = seed;
    return (below: bigint): bigint => {
      state = (state * 6364136223846793005n + 1442695040888963407n) & 0xffff_ffff_ffff_ffffn;
      return (state >> 24n) % below;
    };
  };
  /** The first n − 1 nets as given, the last one balancing the sum back to zero. */
  const balancing = (head: readonly bigint[]): MemberBalance[] =>
    [...head, -head.reduce((sum, net) => sum + net, 0n)].map((net, index) => ({
      memberId: `member-${index}`,
      net,
    }));

  it("lets several debtors pay the one creditor: Juan pays Ana 100,000 COP and Luis pays Ana 50,000 COP", () => {
    const balances = nets(["ana", 15_000_000n], ["juan", -10_000_000n], ["luis", -5_000_000n]);
    expect(simplifyDebts(balances)).toEqual([
      pays("juan", "ana", 10_000_000n),
      pays("luis", "ana", 5_000_000n),
    ]);
  });

  it("collapses Ana owing Juan and Juan owing Luis into one payment from Ana to Luis", () => {
    // Ana owes Juan 100,000 and Juan owes Luis 100,000, so Juan's net is 0.
    expect(simplifyDebts(nets(["ana", -10_000_000n], ["juan", 0n], ["luis", 10_000_000n]))).toEqual([
      pays("ana", "luis", 10_000_000n),
    ]);
  });

  it("suggests nothing for a settled group", () => {
    expect(simplifyDebts(nets(["ana", 0n], ["juan", 0n], ["luis", 0n]))).toEqual([]);
  });

  it("suggests nothing for no balances at all", () => {
    expect(simplifyDebts([])).toEqual([]);
  });

  it("breaks ties by join order, so the same balances always give the same suggestions", () => {
    const balances = nets(["ana", 100n], ["juan", 100n], ["luis", -100n], ["sofi", -100n]);
    expect(simplifyDebts(balances)).toEqual([pays("luis", "ana", 100n), pays("sofi", "juan", 100n)]);
  });

  it("settles every net exactly with at most n − 1 positive payments", () => {
    const balances = nets(["ana", 700n], ["juan", 500n], ["luis", -600n], ["sofi", -400n], ["pedro", -200n]);
    const suggestions = simplifyDebts(balances);
    expect(suggestions).toEqual([
      pays("luis", "ana", 600n),
      pays("sofi", "juan", 400n),
      pays("pedro", "ana", 100n),
      pays("pedro", "juan", 100n),
    ]);
    expect(suggestions.length).toBeLessThanOrEqual(balances.length - 1);
    expect(suggestions.every((s) => s.amount > 0n)).toBe(true);
    expect(flowOf(suggestions, balances)).toEqual(balances.map(({ memberId, net }) => [memberId, -net]));
  });

  it("never involves a member whose net is zero", () => {
    const balances = nets(["ana", 0n], ["juan", 300n], ["luis", 0n], ["sofi", -300n], ["pedro", 0n]);
    expect(simplifyDebts(balances)).toEqual([pays("sofi", "juan", 300n)]);
  });

  it("keeps every amount exact beyond 2^53 minor units, where Number arithmetic would round", () => {
    const big = 2n ** 70n;
    const balances = nets(
      ["ana", big + 1n],
      ["juan", 2n ** 53n + 1n],
      ["luis", -(big + 2n ** 53n + 4n)],
      ["sofi", 2n],
    );
    expect(simplifyDebts(balances)).toEqual([
      pays("luis", "ana", big + 1n),
      pays("luis", "juan", 2n ** 53n + 1n),
      pays("luis", "sofi", 2n),
    ]);
  });

  describe("with nets that do not sum to zero (never produced by a space's balances)", () => {
    /** Settles as far as it goes: the side with less money is cleared, the surplus of the other stays unpaid. */
    const settlesWhatItCan = (balances: readonly MemberBalance[]) => {
      const suggestions = simplifyDebts(balances);
      const active = balances.filter((b) => b.net !== 0n).length;
      expect(suggestions.length).toBeLessThanOrEqual(Math.max(active - 1, 0));
      expect(suggestions.every((s) => s.amount > 0n)).toBe(true);
      expect(suggestions.every((s) => s.payerMemberId !== s.receivingMemberId)).toBe(true);
      for (const { memberId, net } of balances) {
        const received = suggestions.filter((s) => s.receivingMemberId === memberId);
        const paid = suggestions.filter((s) => s.payerMemberId === memberId);
        const receipts = received.reduce((sum, s) => sum + s.amount, 0n);
        const payments = paid.reduce((sum, s) => sum + s.amount, 0n);
        // Nobody pays more than they owe or receives more than they are owed, and nobody does both.
        expect(receipts).toBeLessThanOrEqual(net > 0n ? net : 0n);
        expect(payments).toBeLessThanOrEqual(net < 0n ? -net : 0n);
      }
      const owed = balances.reduce((sum, b) => sum + (b.net > 0n ? b.net : 0n), 0n);
      const owing = balances.reduce((sum, b) => sum + (b.net < 0n ? -b.net : 0n), 0n);
      expect(suggestions.reduce((sum, s) => sum + s.amount, 0n)).toBe(owed < owing ? owed : owing);
      return suggestions;
    };

    it("suggests nothing when there are only creditors", () => {
      expect(settlesWhatItCan(nets(["ana", 300n], ["juan", 200n], ["luis", 0n]))).toEqual([]);
    });

    it("suggests nothing when there are only debtors", () => {
      expect(settlesWhatItCan(nets(["ana", -300n], ["juan", -200n], ["luis", 0n]))).toEqual([]);
    });

    it("stops once the creditors are paid when one debtor owes more than all of them are owed", () => {
      expect(settlesWhatItCan(nets(["ana", 100n], ["juan", 50n], ["luis", -400n]))).toEqual([
        pays("luis", "ana", 100n),
        pays("luis", "juan", 50n),
      ]);
    });

    it("stops once the debtors have paid when one creditor is owed more than all of them owe", () => {
      expect(settlesWhatItCan(nets(["ana", 400n], ["juan", -100n], ["luis", -50n]))).toEqual([
        pays("juan", "ana", 100n),
        pays("luis", "ana", 50n),
      ]);
    });

    it("terminates with bounded, positive payments over generated vectors that need not sum to zero", () => {
      const next = seeded(20_261_015n);
      for (let round = 0; round < 200; round += 1) {
        const size = 1 + Number(next(12n));
        const limit = 1n + next(2_000_000n);
        const balances = Array.from({ length: size }, (_, index) => ({
          memberId: `member-${index}`,
          net: next(3n) === 0n ? 0n : next(2n * limit + 1n) - limit,
        }));
        settlesWhatItCan(balances);
      }
    });
  });

  it("leaves the balances it was given unchanged", () => {
    const balances = nets(["ana", 100n], ["juan", -100n]);
    simplifyDebts(balances);
    expect(balances).toEqual(nets(["ana", 100n], ["juan", -100n]));
  });

  describe("over generated balances that sum to zero", () => {
    const repeated = (count: number, net: bigint) => Array.from({ length: count }, () => net);
    const generated = (): { name: string; balances: MemberBalance[] }[] => {
      const next = seeded(20_261_014n);
      const signed = (limit: bigint) => next(2n * limit + 1n) - limit;
      const cases = [
        { name: "a single member", balances: balancing([]) },
        { name: "everyone settled", balances: balancing(repeated(4, 0n)) },
        { name: "one big creditor and many small debtors", balances: balancing(repeated(9, -100n)) },
        { name: "one big debtor and many small creditors", balances: balancing(repeated(9, 100n)) },
        { name: "equal creditors and equal debtors", balances: balancing([100n, 100n, 100n, -100n, -100n]) },
        {
          name: "ties with zero nets in between",
          balances: balancing([100n, 0n, -100n, 0n, 100n, 0n, -100n]),
        },
        { name: "two members", balances: balancing([12_345n]) },
        {
          name: "amounts around 2^70 minor units",
          balances: balancing([2n ** 70n + 1n, 2n ** 53n + 1n, -(2n ** 70n) - 7n, -(2n ** 69n) - 3n]),
        },
      ];
      for (let round = 0; round < 300; round += 1) {
        const size = 2 + Number(next(11n));
        const zeroOneIn = 1n + next(4n);
        const limit = 1n + next(2_000_000n);
        const head = Array.from({ length: size - 1 }, () => (next(zeroOneIn) === 0n ? 0n : signed(limit)));
        cases.push({ name: `random vector ${round} of ${size} members`, balances: balancing(head) });
      }
      // Amounts from 2^64 to 2^84 with random low bits, far beyond 2^53, where Number arithmetic would round.
      const wide = () => (signed(1_000_000n) || 1n) * 2n ** 64n + next(2n ** 40n);
      for (let round = 0; round < 50; round += 1) {
        const size = 2 + Number(next(11n));
        const head = Array.from({ length: size - 1 }, () => (next(4n) === 0n ? 0n : wide()));
        cases.push({ name: `wide random vector ${round} of ${size} members`, balances: balancing(head) });
      }
      return cases;
    };

    it.each(generated())("clears $name with at most n − 1 positive payments", ({ balances }) => {
      const suggestions = simplifyDebts(balances);
      const netOfMember = new Map(balances.map((b) => [b.memberId, b.net]));
      // Sanity of the generator itself: the nets sum to zero, as the balances of a space always do.
      expect(balances.reduce((sum, b) => sum + b.net, 0n)).toBe(0n);
      // (a) at most n − 1 payments.
      expect(suggestions.length).toBeLessThanOrEqual(Math.max(balances.length - 1, 0));
      // (b) every amount is positive, (d) nobody pays themselves.
      expect(suggestions.every((s) => s.amount > 0n)).toBe(true);
      expect(suggestions.every((s) => s.payerMemberId !== s.receivingMemberId)).toBe(true);
      // Debtors pay and creditors receive, so a member with a zero net appears in no suggestion.
      expect(suggestions.every((s) => (netOfMember.get(s.payerMemberId) ?? 0n) < 0n)).toBe(true);
      expect(suggestions.every((s) => (netOfMember.get(s.receivingMemberId) ?? 0n) > 0n)).toBe(true);
      // (c) for every member, receipts − payments equals their net exactly.
      for (const { memberId, net } of balances) {
        const received = suggestions.filter((s) => s.receivingMemberId === memberId);
        const paid = suggestions.filter((s) => s.payerMemberId === memberId);
        expect(
          received.reduce((sum, s) => sum + s.amount, 0n) - paid.reduce((sum, s) => sum + s.amount, 0n),
        ).toBe(net);
      }
      // (e) the same input gives the same output, ties included.
      expect(simplifyDebts(balances)).toEqual(suggestions);
      expect(simplifyDebts(balances.map((b) => ({ ...b })))).toEqual(suggestions);
    });
  });
});
