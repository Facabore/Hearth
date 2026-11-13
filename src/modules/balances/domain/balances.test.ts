import { describe, expect, it } from "vitest";
import type { Result } from "@/shared/kernel";
import {
  netBalances,
  netOf,
  pairwiseDebts,
  type DebtExpense,
  type DebtMovements,
  type DebtSettlement,
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

/** A deterministic 64-bit linear congruential generator over bigint, so no amount ever passes through Number. */
const seeded = (seed: bigint) => {
  let state = seed;
  return (below: bigint): bigint => {
    state = (state * 6364136223846793005n + 1442695040888963407n) & 0xffff_ffff_ffff_ffffn;
    return (state >> 24n) % below;
  };
};

const valueOf = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}`);
  return result.value;
};

describe("pairwise debts (ruling P323)", () => {
  const pesos = (n: bigint) => n * 100n;
  const MEMBERS = ["kamilox", "yuberley", "roger", "sofi"];
  const expense = (
    payments: readonly (readonly [string | null, bigint])[],
    shares: readonly (readonly [string, bigint])[],
  ): DebtExpense => ({
    payments: payments.map(([memberId, amount]) => ({ memberId, amount })),
    shares: shares.map(([memberId, amount]) => ({ memberId, amount })),
  });
  const settlement = (
    payerMemberId: string,
    receivingMemberId: string,
    amount: bigint,
    reason: DebtSettlement["reason"] = "PAYMENT",
    onBehalfOfMemberId: string | null = null,
  ): DebtSettlement => ({ payerMemberId, receivingMemberId, amount, reason, onBehalfOfMemberId });
  const pays = (payerMemberId: string, receivingMemberId: string, amount: bigint): SettlementSuggestion => ({
    payerMemberId,
    receivingMemberId,
    amount,
  });
  const debts = (
    expenses: readonly DebtExpense[],
    settlements: readonly DebtSettlement[] = [],
    memberIds: readonly string[] = MEMBERS,
  ) => valueOf(pairwiseDebts("COP", memberIds, { expenses, settlements }));

  /** The ledger of S5 on staging (Friends 3): Kamilox paid 50,000 with Yuberley; Yuberley paid 16,000 and 15,000 for the three. */
  const friends3 = [
    expense(
      [["kamilox", pesos(50_000n)]],
      [
        ["kamilox", pesos(25_000n)],
        ["yuberley", pesos(25_000n)],
      ],
    ),
    expense(
      [["yuberley", pesos(16_000n)]],
      [
        ["kamilox", pesos(5_334n)],
        ["yuberley", pesos(5_333n)],
        ["roger", pesos(5_333n)],
      ],
    ),
    expense(
      [["yuberley", pesos(15_000n)]],
      [
        ["kamilox", pesos(5_000n)],
        ["yuberley", pesos(5_000n)],
        ["roger", pesos(5_000n)],
      ],
    ),
  ];

  it("has Roger pay Yuberley 10,333 and Yuberley pay Kamilox 14,666, never Roger pay Kamilox (S5)", () => {
    expect(debts(friends3)).toEqual([
      pays("yuberley", "kamilox", pesos(14_666n)),
      pays("roger", "yuberley", pesos(10_333n)),
    ]);
  });

  it("never has a member owe themself", () => {
    expect(
      debts([
        expense(
          [["kamilox", pesos(100_000n)]],
          [
            ["kamilox", pesos(50_000n)],
            ["yuberley", pesos(50_000n)],
          ],
        ),
      ]),
    ).toEqual([pays("yuberley", "kamilox", pesos(50_000n))]);
  });

  it("splits each share between two payers in proportion to what each paid, and the parts add up", () => {
    // Kamilox paid 60,000 and Yuberley 40,000 of 100,000 split in three: 33,334 / 33,333 / 33,333.
    const result = debts([
      expense(
        [
          ["kamilox", pesos(60_000n)],
          ["yuberley", pesos(40_000n)],
        ],
        [
          ["kamilox", pesos(33_334n)],
          ["yuberley", pesos(33_333n)],
          ["roger", pesos(33_333n)],
        ],
      ),
    ]);
    // Kamilox owes Yuberley 13,334 of his share; Yuberley owes Kamilox 20,000 of hers; Roger owes 20,000 and 13,333.
    expect(result).toEqual([
      pays("roger", "kamilox", pesos(20_000n)),
      pays("roger", "yuberley", pesos(13_333n)),
      pays("yuberley", "kamilox", pesos(6_666n)),
    ]);
  });

  it("creates no debt for an expense paid from the shared fund (D5)", () => {
    expect(
      debts([
        expense(
          [[null, pesos(90_000n)]],
          [
            ["kamilox", pesos(45_000n)],
            ["yuberley", pesos(45_000n)],
          ],
        ),
      ]),
    ).toEqual([]);
  });

  it("suggests nothing without movements", () => {
    expect(debts([])).toEqual([]);
  });

  describe("settlements", () => {
    const kamiloxPaysForRoger = expense([["kamilox", pesos(100_000n)]], [["roger", pesos(100_000n)]]);

    it("lowers the payer's debt to the receiver", () => {
      expect(debts([kamiloxPaysForRoger], [settlement("roger", "kamilox", pesos(40_000n))])).toEqual([
        pays("roger", "kamilox", pesos(60_000n)),
      ]);
    });

    it("clears the pair when it pays the debt exactly", () => {
      expect(debts([kamiloxPaysForRoger], [settlement("roger", "kamilox", pesos(100_000n))])).toEqual([]);
    });

    it("turns the debt around when it overshoots", () => {
      expect(debts([kamiloxPaysForRoger], [settlement("roger", "kamilox", pesos(130_000n))])).toEqual([
        pays("kamilox", "roger", pesos(30_000n)),
      ]);
    });

    it("only touches its own pair", () => {
      const yuberleyPaysForSofi = expense([["yuberley", pesos(20_000n)]], [["sofi", pesos(20_000n)]]);
      expect(
        debts([kamiloxPaysForRoger, yuberleyPaysForSofi], [settlement("roger", "yuberley", pesos(5_000n))]),
      ).toEqual([
        pays("roger", "kamilox", pesos(100_000n)),
        pays("sofi", "yuberley", pesos(20_000n)),
        pays("yuberley", "roger", pesos(5_000n)),
      ]);
    });

    it("moves Roger's debt from Kamilox to Yuberley when Yuberley pays it for him as a loan (P322)", () => {
      expect(
        debts(
          [kamiloxPaysForRoger],
          [settlement("yuberley", "kamilox", pesos(100_000n), "PAYMENT", "roger")],
        ),
      ).toEqual([pays("roger", "yuberley", pesos(100_000n))]);
    });

    it("moves only the part paid for him", () => {
      expect(
        debts([kamiloxPaysForRoger], [settlement("yuberley", "kamilox", pesos(30_000n), "PAYMENT", "roger")]),
      ).toEqual([pays("roger", "kamilox", pesos(70_000n)), pays("roger", "yuberley", pesos(30_000n))]);
    });

    it("clears Roger's debt when Yuberley gives away what she paid for him (P322 gift)", () => {
      expect(
        debts(
          [kamiloxPaysForRoger],
          [
            settlement("yuberley", "kamilox", pesos(100_000n), "PAYMENT", "roger"),
            settlement("roger", "yuberley", pesos(100_000n), "GIFT"),
          ],
        ),
      ).toEqual([]);
    });

    it("lowers what Roger owes Kamilox by what Kamilox forgives (P322 forgiveness)", () => {
      expect(
        debts([kamiloxPaysForRoger], [settlement("roger", "kamilox", pesos(30_000n), "FORGIVENESS")]),
      ).toEqual([pays("roger", "kamilox", pesos(70_000n))]);
    });
  });

  describe("order", () => {
    it("lists the largest debt first, then by the payer's join order, then the receiver's", () => {
      const owes = (debtor: string, creditor: string, amount: bigint) =>
        expense([[creditor, amount]], [[debtor, amount]]);
      expect(
        debts([
          owes("sofi", "roger", 100n),
          owes("roger", "kamilox", 100n),
          owes("yuberley", "kamilox", 100n),
          owes("sofi", "kamilox", 100n),
          owes("roger", "yuberley", 500n),
        ]),
      ).toEqual([
        pays("roger", "yuberley", 500n),
        pays("yuberley", "kamilox", 100n),
        pays("roger", "kamilox", 100n),
        pays("sofi", "kamilox", 100n),
        pays("sofi", "roger", 100n),
      ]);
    });

    it("places members who are no longer current after the current ones, by id", () => {
      expect(
        debts(
          [
            expense([["kamilox", 100n]], [["zed", 100n]]),
            expense([["kamilox", 100n]], [["xavi", 100n]]),
            expense([["kamilox", 100n]], [["yuberley", 100n]]),
          ],
          [],
          ["kamilox", "yuberley"],
        ),
      ).toEqual([
        pays("yuberley", "kamilox", 100n),
        pays("xavi", "kamilox", 100n),
        pays("zed", "kamilox", 100n),
      ]);
    });
  });

  it("answers UnknownCurrency for a currency Money does not know", () => {
    const result = pairwiseDebts("XXX", MEMBERS, { expenses: friends3, settlements: [] });
    expect(result.ok ? "ok" : result.error.code).toBe("UnknownCurrency");
  });

  describe("S4: every member's pairs add up to their net balance (E5 rule)", () => {
    /** The E5 totals of the same movements, as the ledger sums them: fund-paid expenses count for nothing (D5). */
    const netsOf = (movements: DebtMovements) => {
      const sums = new Map<string, MemberTotals>();
      const add = (memberId: string, field: keyof Omit<MemberTotals, "memberId">, amount: bigint) => {
        const current = sums.get(memberId) ?? totals(memberId, 0n, 0n);
        sums.set(memberId, { ...current, [field]: current[field] + amount });
      };
      for (const e of movements.expenses) {
        if (e.payments.some((p) => p.memberId === null)) continue;
        for (const p of e.payments) add(p.memberId!, "paid", p.amount);
        for (const s of e.shares) add(s.memberId, "consumed", s.amount);
      }
      for (const s of movements.settlements) {
        add(s.payerMemberId, "settledOut", s.amount);
        add(s.receivingMemberId, "settledIn", s.amount);
      }
      return new Map([...sums.values()].map((t) => [t.memberId, netOf(t)]));
    };

    /** Splits `total` (≥ count) into `count` positive parts. */
    const partsOf = (next: (below: bigint) => bigint, total: bigint, count: number) => {
      const parts: bigint[] = [];
      let left = total;
      for (let i = 0; i < count - 1; i += 1) {
        const part = 1n + next(left - BigInt(count - 1 - i));
        parts.push(part);
        left -= part;
      }
      return [...parts, left];
    };
    const pick = <T>(next: (below: bigint) => bigint, items: readonly T[]) =>
      items[Number(next(BigInt(items.length)))]!;
    const distinct = (next: (below: bigint) => bigint, items: readonly string[], count: number) => {
      const pool = [...items];
      return Array.from(
        { length: Math.min(count, pool.length) },
        () => pool.splice(Number(next(BigInt(pool.length))), 1)[0]!,
      );
    };

    const generated = () => {
      const next = seeded(20_261_112n);
      const cases: { name: string; currency: string; memberIds: string[]; movements: DebtMovements }[] = [
        {
          name: "the staging example (S5)",
          currency: "COP",
          memberIds: MEMBERS,
          movements: { expenses: friends3, settlements: [] },
        },
      ];
      for (let round = 0; round < 300; round += 1) {
        const size = 2 + Number(next(6n));
        const everyone = Array.from({ length: size }, (_, i) => `member-${i}`);
        // Some members left the space: their history still counts.
        const memberIds = everyone.filter(() => next(5n) !== 0n);
        const currency = pick(next, ["COP", "USD"]);
        // COP amounts are whole pesos most of the time, as people record them; sometimes not, to stress sub-units.
        const scale = currency === "COP" && next(3n) !== 0n ? 100n : 1n;
        const limit = 1n + next(next(2n) === 0n ? 1_000n : 10_000_000n);
        const expenses: DebtExpense[] = Array.from({ length: Number(next(8n)) }, () => {
          const fund = next(6n) === 0n;
          const payers = fund ? [null] : distinct(next, everyone, 1 + Number(next(3n)));
          const paid = payers.map(() => 1n + next(limit));
          const total = paid.reduce((a, b) => a + b, 0n);
          const sharers = distinct(next, everyone, 1 + Number(next(BigInt(size))));
          const shareCount = Number(BigInt(sharers.length) < total ? BigInt(sharers.length) : total);
          const shares = partsOf(next, total, shareCount);
          return expense(
            payers.map((memberId, i) => [memberId, paid[i]! * scale] as const),
            shares.map((amount, i) => [sharers[i]!, amount * scale] as const),
          );
        });
        const settlements: DebtSettlement[] = Array.from({ length: Number(next(6n)) }, () => {
          const [payer, receiver, third] = distinct(next, everyone, 3);
          const amount = (1n + next(limit)) * scale;
          const kind = next(4n);
          if (kind === 0n && third !== undefined)
            return settlement(payer!, receiver!, amount, "PAYMENT", third);
          if (kind === 1n) return settlement(payer!, receiver!, amount, "GIFT");
          if (kind === 2n) return settlement(payer!, receiver!, amount, "FORGIVENESS");
          return settlement(payer!, receiver!, amount);
        });
        cases.push({
          name: `random ledger ${round} of ${size} members in ${currency}`,
          currency,
          memberIds,
          movements: { expenses, settlements },
        });
      }
      return cases;
    };

    it.each(generated())("holds for $name", ({ currency, memberIds, movements }) => {
      const suggestions = valueOf(pairwiseDebts(currency, memberIds, movements));
      const nets = netsOf(movements);
      for (const memberId of new Set([
        ...nets.keys(),
        ...suggestions.flatMap((s) => [s.payerMemberId, s.receivingMemberId]),
      ])) {
        const owed = suggestions
          .filter((s) => s.receivingMemberId === memberId)
          .reduce((sum, s) => sum + s.amount, 0n);
        const owes = suggestions
          .filter((s) => s.payerMemberId === memberId)
          .reduce((sum, s) => sum + s.amount, 0n);
        expect(owed - owes, memberId).toBe(nets.get(memberId) ?? 0n);
      }
      // One positive suggestion per pair at most, and nobody pays themself.
      expect(suggestions.every((s) => s.amount > 0n && s.payerMemberId !== s.receivingMemberId)).toBe(true);
      const pairs = suggestions.map((s) => [s.payerMemberId, s.receivingMemberId].sort().join(" "));
      expect(new Set(pairs).size).toBe(pairs.length);
      // The same movements always give the same suggestions.
      expect(valueOf(pairwiseDebts(currency, memberIds, movements))).toEqual(suggestions);
    });
  });
});
