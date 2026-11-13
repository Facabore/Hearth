import { currencyOf, flatMap, Money, ok, type Result } from "@/shared/kernel";

/** Per-member sums over the live transactions of one space that move balances (E5 balance rule). */
export interface MemberTotals {
  readonly memberId: string;
  /** Σ payments by the member on member-paid expenses. */
  readonly paid: bigint;
  /** Σ shares of the member on member-paid expenses. */
  readonly consumed: bigint;
  /** Σ settlements the member paid. */
  readonly settledOut: bigint;
  /** Σ settlements the member received. */
  readonly settledIn: bigint;
}

export interface MemberBalance {
  readonly memberId: string;
  /** Positive: the member is owed money; negative: the member owes. */
  readonly net: bigint;
}

/** E5 balance rule: net(m) = Σ payments − Σ shares + settlements paid − settlements received. */
export const netOf = (totals: MemberTotals): bigint =>
  totals.paid - totals.consumed + totals.settledOut - totals.settledIn;

/**
 * HU-E5-01: one balance per current member in join order (0 when nothing moved it), then anyone else
 * the totals mention, by id, so the balances of a space always sum to zero.
 */
export const netBalances = (
  memberIds: readonly string[],
  totals: readonly MemberTotals[],
): MemberBalance[] => {
  const byMember = new Map(totals.map((t) => [t.memberId, netOf(t)]));
  const others = [...byMember.keys()].filter((id) => !memberIds.includes(id)).sort();
  return [...memberIds, ...others].map((memberId) => ({ memberId, net: byMember.get(memberId) ?? 0n }));
};

/** #217 (P263): a member's balance and whether any live movement that counts for balances ever touched them. */
export interface MemberStanding extends MemberBalance {
  /**
   * True once a live member-paid expense (as payer or participant) or a live settlement names the member, even when
   * their net is back to 0. Fund-paid expenses, fund contributions and deleted rows never count, as for the net.
   */
  readonly hasMovements: boolean;
}

/** #217 (P263): `netBalances`, each with whether the totals mention the member; computed on read (D7). */
export const memberStandings = (
  memberIds: readonly string[],
  totals: readonly MemberTotals[],
): MemberStanding[] => {
  const moved = new Set(totals.map((t) => t.memberId));
  return netBalances(memberIds, totals).map((balance) => ({
    ...balance,
    hasMovements: moved.has(balance.memberId),
  }));
};

/** HU-E5-03: one suggested payment; accepting it is a regular settlement (HU-E5-02). */
export interface SettlementSuggestion {
  readonly payerMemberId: string;
  readonly receivingMemberId: string;
  /** Minor units, always positive. */
  readonly amount: bigint;
}

/** Ruling P323: one member-paid part of an expense, in minor units; a fund payment has no member (D5). */
export interface DebtPart<M extends string | null = string> {
  readonly memberId: M;
  readonly amount: bigint;
}

/** Ruling P323: a live expense of the space, with its payments and shares in position order. */
export interface DebtExpense {
  readonly payments: readonly DebtPart<string | null>[];
  readonly shares: readonly DebtPart[];
}

/** Ruling P323: a live settlement of the space (HU-E5-02), with why it was recorded and for whom (P322). */
export interface DebtSettlement {
  readonly payerMemberId: string;
  readonly receivingMemberId: string;
  readonly amount: bigint;
  readonly reason: "PAYMENT" | "GIFT" | "FORGIVENESS";
  readonly onBehalfOfMemberId: string | null;
}

/** Ruling P323: the live movements of one space that create or settle debts between its members. */
export interface DebtMovements {
  readonly expenses: readonly DebtExpense[];
  readonly settlements: readonly DebtSettlement[];
}

/** Ruling P323: what each pair of members owes, netted over every movement between the two (positive: `a` owes `b`). */
class PairLedger {
  private readonly owed = new Map<string, { a: string; b: string; net: bigint }>();

  owe(debtor: string, creditor: string, amount: bigint): void {
    if (debtor === creditor || amount === 0n) return;
    const [a, b, sign] = debtor < creditor ? [debtor, creditor, 1n] : [creditor, debtor, -1n];
    const key = `${a}\n${b}`;
    const pair = this.owed.get(key) ?? { a, b, net: 0n };
    pair.net += sign * amount;
    this.owed.set(key, pair);
  }

  debts(): SettlementSuggestion[] {
    return [...this.owed.values()]
      .filter((pair) => pair.net !== 0n)
      .map((pair) =>
        pair.net > 0n
          ? { payerMemberId: pair.a, receivingMemberId: pair.b, amount: pair.net }
          : { payerMemberId: pair.b, receivingMemberId: pair.a, amount: -pair.net },
      );
  }
}

/**
 * Ruling P323: each participant owes each member payer their share in proportion to what that payer paid. A share is
 * allocated with Money's own largest-remainder rule over what each payer is still owed from this expense, and the
 * last share takes exactly what is left, so the parts of every share add up to it and the parts owed to every payer
 * add up to what they paid (Σ payments = Σ shares, spec 5.2). An expense with a fund payment creates no debt (D5).
 */
const oweExpense = (currency: string, expense: DebtExpense, pairs: PairLedger): Result<void> => {
  const payers: DebtPart[] = [];
  for (const payment of expense.payments) {
    if (payment.memberId === null) return ok(undefined);
    payers.push({ memberId: payment.memberId, amount: payment.amount });
  }
  const left = payers.map((payer) => payer.amount);
  for (const [index, share] of expense.shares.entries()) {
    let parts: readonly bigint[] = [...left];
    if (index < expense.shares.length - 1) {
      const weights = left.map((amount) => (amount > 0n ? amount : 0n));
      const allocated = flatMap(Money.ofMinor(share.amount, currency), (money) => money.allocate(weights));
      if (!allocated.ok) return allocated;
      parts = allocated.value.map((part) => part.minor);
    }
    parts.forEach((part, i) => {
      left[i] = left[i]! - part;
      pairs.owe(share.memberId, payers[i]!.memberId, part);
    });
  }
  return ok(undefined);
};

/**
 * Ruling P323: settlements net against the pair they name. A PAYMENT from A to B for C (P322) lowers C's debt to B and
 * makes C owe A instead; any other settlement, a GIFT or a FORGIVENESS included, lowers its payer's debt to its
 * receiver, and one that pays more than the debt turns it around.
 */
const oweSettlement = (settlement: DebtSettlement, pairs: PairLedger): void => {
  const { payerMemberId, receivingMemberId, amount, onBehalfOfMemberId } = settlement;
  if (settlement.reason === "PAYMENT" && onBehalfOfMemberId !== null) {
    pairs.owe(onBehalfOfMemberId, receivingMemberId, -amount);
    pairs.owe(onBehalfOfMemberId, payerMemberId, amount);
    return;
  }
  pairs.owe(payerMemberId, receivingMemberId, -amount);
};

/**
 * Ruling P323: nobody can settle with someone who is no longer a member, so what others owe them goes straight to
 * whom they owe, in place order, until one side runs out. Every member's net stays as it was; what is left of theirs
 * stays with them.
 */
const routeThrough = (gone: string, pairs: PairLedger, placeOf: (id: string) => number): void => {
  const byPlace =
    (id: (debt: SettlementSuggestion) => string) => (x: SettlementSuggestion, y: SettlementSuggestion) =>
      placeOf(id(x)) - placeOf(id(y));
  const debts = pairs.debts();
  const owing = debts.filter((d) => d.receivingMemberId === gone).sort(byPlace((d) => d.payerMemberId));
  const owed = debts.filter((d) => d.payerMemberId === gone).sort(byPlace((d) => d.receivingMemberId));
  const left = { owing: owing.map((d) => d.amount), owed: owed.map((d) => d.amount) };
  for (let i = 0, j = 0; i < owing.length && j < owed.length;) {
    const amount = left.owing[i]! < left.owed[j]! ? left.owing[i]! : left.owed[j]!;
    const debtor = owing[i]!.payerMemberId;
    const creditor = owed[j]!.receivingMemberId;
    pairs.owe(debtor, gone, -amount);
    pairs.owe(gone, creditor, -amount);
    pairs.owe(debtor, creditor, amount);
    left.owing[i]! -= amount;
    left.owed[j]! -= amount;
    if (left.owing[i] === 0n) i += 1;
    if (left.owed[j] === 0n) j += 1;
  }
};

/**
 * HU-E5-03, ruling P323: who pays whom, without simplification. For every pair of members, the net of what each owes
 * the other over the space's live member-paid expenses and settlements; one suggestion per pair that owes anything,
 * from the member who owes to the member owed. For every member, what they are owed minus what they owe over their
 * pairs equals their net balance (E5 rule). The largest debt comes first; ties go by the payer's place and then the
 * receiver's: `memberIds` (join order), then anyone else by id. Computed on read (D7). UnknownCurrency for a currency
 * Money does not know.
 */
export const pairwiseDebts = (
  currency: string,
  memberIds: readonly string[],
  movements: DebtMovements,
): Result<SettlementSuggestion[]> => {
  const known = currencyOf(currency);
  if (!known.ok) return known;
  const pairs = new PairLedger();
  for (const expense of movements.expenses) {
    const owed = oweExpense(currency, expense, pairs);
    if (!owed.ok) return owed;
  }
  for (const settlement of movements.settlements) oweSettlement(settlement, pairs);
  const others = [...new Set(pairs.debts().flatMap((d) => [d.payerMemberId, d.receivingMemberId]))]
    .filter((id) => !memberIds.includes(id))
    .sort();
  const place = new Map([...memberIds, ...others].map((id, index) => [id, index]));
  const placeOf = (id: string) => place.get(id)!;
  for (const gone of others) routeThrough(gone, pairs, placeOf);
  return ok(
    pairs
      .debts()
      .sort(
        (x, y) =>
          (x.amount === y.amount ? 0 : x.amount > y.amount ? -1 : 1) ||
          placeOf(x.payerMemberId) - placeOf(y.payerMemberId) ||
          placeOf(x.receivingMemberId) - placeOf(y.receivingMemberId),
      ),
  );
};
