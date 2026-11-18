import { currencyOf, flatMap, Money, ok, type LocalDate, type Result } from "@/shared/kernel";

/**
 * Per-member sums over the live transactions of one space that move balances (E5 balance rule), in one currency: a
 * member with movements in several currencies has one row per currency (ruling P342).
 */
export interface MemberTotals {
  /** ISO 4217 code of every amount in this row. */
  readonly currency: string;
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

/** `MemberTotals` of a single currency the caller already knows (ruling P342). */
export type OneCurrencyMemberTotals = Omit<MemberTotals, "currency">;

export interface MemberBalance {
  readonly memberId: string;
  /** Positive: the member is owed money; negative: the member owes. */
  readonly net: bigint;
}

/** E5 balance rule: net(m) = Σ payments − Σ shares + settlements paid − settlements received. */
export const netOf = (totals: OneCurrencyMemberTotals): bigint =>
  totals.paid - totals.consumed + totals.settledOut - totals.settledIn;

/**
 * HU-E5-01: one balance per current member in join order (0 when nothing moved it), then anyone else
 * the totals mention, by id, so the balances of a space always sum to zero.
 */
export const netBalances = (
  memberIds: readonly string[],
  totals: readonly OneCurrencyMemberTotals[],
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
  totals: readonly OneCurrencyMemberTotals[],
): MemberStanding[] => {
  const moved = new Set(totals.map((t) => t.memberId));
  return netBalances(memberIds, totals).map((balance) => ({
    ...balance,
    hasMovements: moved.has(balance.memberId),
  }));
};

/** Ruling P342: the space's currency first, then every other currency by ISO code. */
const currencyOrder =
  (spaceCurrency: string) =>
  (x: string, y: string): number =>
    x === y ? 0 : x === spaceCurrency ? -1 : y === spaceCurrency ? 1 : x < y ? -1 : 1;

/** Ruling P342: groups `items` by their currency, in `currencyOrder`; `always` gets a group even when empty. */
const byCurrency = <T extends { readonly currency: string }>(
  spaceCurrency: string,
  items: readonly T[],
  always: readonly string[] = [],
): [string, T[]][] => {
  const groups = new Map<string, T[]>(always.map((currency) => [currency, []]));
  for (const item of items) groups.set(item.currency, [...(groups.get(item.currency) ?? []), item]);
  return [...groups.entries()].sort(([x], [y]) => currencyOrder(spaceCurrency)(x, y));
};

/** Ruling P342: the standings of one currency's movements; its nets sum to zero. */
export interface CurrencyStandings {
  readonly currency: string;
  readonly members: MemberStanding[];
}

/**
 * Ruling P342 (S4): `memberStandings` per currency, never converted: one group for the space currency (every member at
 * 0 when nothing moved) and one for every other currency the totals mention, the space currency first, then by ISO
 * code. Each group follows the per-member rules of `memberStandings` over that currency's totals alone, so its nets sum
 * to zero and `hasMovements` means a movement in that currency. Computed on read (D7).
 */
export const memberStandingsByCurrency = (
  spaceCurrency: string,
  memberIds: readonly string[],
  totals: readonly MemberTotals[],
): CurrencyStandings[] =>
  byCurrency(spaceCurrency, totals, [spaceCurrency]).map(([currency, inCurrency]) => ({
    currency,
    members: memberStandings(memberIds, inCurrency),
  }));

/** HU-E5-03: one suggested payment; accepting it is a regular settlement (HU-E5-02). */
export interface SettlementSuggestion {
  readonly payerMemberId: string;
  readonly receivingMemberId: string;
  /** Minor units of `currency`, always positive. */
  readonly amount: bigint;
  /** Ruling P342: the debt's currency, the one its movements were made in. */
  readonly currency: string;
}

/** What one pair owes inside a currency the caller already knows. */
type PairDebt = Omit<SettlementSuggestion, "currency">;

/** Ruling P323: one member-paid part of an expense, in minor units; a fund payment has no member (D5). */
export interface DebtPart<M extends string | null = string> {
  readonly memberId: M;
  readonly amount: bigint;
}

/** Ruling P323: a live expense of the space, with its payments and shares in position order, in its currency (P342). */
export interface DebtExpense {
  readonly currency: string;
  readonly payments: readonly DebtPart<string | null>[];
  readonly shares: readonly DebtPart[];
}

/**
 * Ruling P323: a live settlement of the space (HU-E5-02), with why it was recorded and for whom (P322), in the currency
 * it was paid in (P342).
 */
export interface DebtSettlement {
  readonly currency: string;
  readonly payerMemberId: string;
  readonly receivingMemberId: string;
  readonly amount: bigint;
  readonly reason: "PAYMENT" | "GIFT" | "FORGIVENESS";
  readonly onBehalfOfMemberId: string | null;
}

/** Ruling P323: the live movements of one space that create or settle debts between its members, in any currency. */
export interface DebtMovements {
  readonly expenses: readonly DebtExpense[];
  readonly settlements: readonly DebtSettlement[];
}

/** A `DebtExpense` of a single currency the caller already knows (ruling P342). */
export type OneCurrencyDebtExpense = Omit<DebtExpense, "currency">;
/** A `DebtSettlement` of a single currency the caller already knows (ruling P342). */
export type OneCurrencyDebtSettlement = Omit<DebtSettlement, "currency">;

/** `DebtMovements` all in one currency the caller already knows (ruling P342). */
export interface OneCurrencyDebtMovements {
  readonly expenses: readonly OneCurrencyDebtExpense[];
  readonly settlements: readonly OneCurrencyDebtSettlement[];
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

  /** Ruling P339: what `debtor` owes `creditor` now; negative when the creditor is the one who owes. */
  owedBy(debtor: string, creditor: string): bigint {
    const [a, b, sign] = debtor < creditor ? [debtor, creditor, 1n] : [creditor, debtor, -1n];
    return sign * (this.owed.get(`${a}\n${b}`)?.net ?? 0n);
  }

  debts(): PairDebt[] {
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
const oweExpense = (currency: string, expense: OneCurrencyDebtExpense, pairs: PairLedger): Result<void> => {
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
const oweSettlement = (settlement: OneCurrencyDebtSettlement, pairs: PairLedger): void => {
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
  const byPlace = (id: (debt: PairDebt) => string) => (x: PairDebt, y: PairDebt) =>
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
 * receiver's: `memberIds` (join order), then anyone else by id. Every movement is taken to be in `currency`, which
 * each suggestion carries (P342). Computed on read (D7). UnknownCurrency for a currency Money does not know.
 */
export const pairwiseDebts = (
  currency: string,
  memberIds: readonly string[],
  movements: OneCurrencyDebtMovements,
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
      )
      .map((debt) => ({ ...debt, currency })),
  );
};

/**
 * Ruling P342 (S4): `pairwiseDebts` per currency, never converted: each currency's expenses and settlements net only
 * against each other, so a member may owe someone in one currency and be owed by them in another, and a debt to someone
 * who left goes through them inside its own currency. Grouped by currency, the space currency first, then by ISO code;
 * inside a group, the order of `pairwiseDebts`. UnknownCurrency for a space or movement currency Money does not know.
 */
export const pairwiseDebtsByCurrency = (
  spaceCurrency: string,
  memberIds: readonly string[],
  movements: DebtMovements,
): Result<SettlementSuggestion[]> => {
  const known = currencyOf(spaceCurrency);
  if (!known.ok) return known;
  const expenses = new Map(byCurrency(spaceCurrency, movements.expenses));
  const settlements = new Map(byCurrency(spaceCurrency, movements.settlements));
  const currencies = [...new Set([...expenses.keys(), ...settlements.keys()])].sort(
    currencyOrder(spaceCurrency),
  );
  const suggestions: SettlementSuggestion[] = [];
  for (const currency of currencies) {
    const debts = pairwiseDebts(currency, memberIds, {
      expenses: expenses.get(currency) ?? [],
      settlements: settlements.get(currency) ?? [],
    });
    if (!debts.ok) return debts;
    suggestions.push(...debts.value);
  }
  return ok(suggestions);
};

/** Ruling P339: a movement's place in its space's history: its date, when it was recorded, then its id. */
export interface DebtPlace {
  readonly transactionId: string;
  readonly date: LocalDate;
  readonly createdAt: Date;
}

/** Ruling P339: `DebtMovements`, each with its place in the space's history. */
export interface DatedDebtMovements {
  readonly expenses: readonly (OneCurrencyDebtExpense & DebtPlace)[];
  readonly settlements: readonly (OneCurrencyDebtSettlement & DebtPlace)[];
}

/**
 * Ruling P339 (S9): what a payment did between its payer and its receiver, by what the payer owed the receiver just
 * before it: it pays that debt (PAID), lends all of it when the payer owed nothing (LENT), or pays the debt and lends
 * the rest (PAID_AND_LENT). `paid + lent` is the payment's amount.
 */
export interface SettlementContext {
  readonly kind: "PAID" | "LENT" | "PAID_AND_LENT";
  readonly paid: bigint;
  readonly lent: bigint;
}

/** The order of a space's balance history (HU-E5-04): date, then when it was recorded, then id. */
const inHistoryOrder = (x: DebtPlace, y: DebtPlace): number =>
  x.date !== y.date
    ? x.date < y.date
      ? -1
      : 1
    : x.createdAt.getTime() !== y.createdAt.getTime()
      ? x.createdAt.getTime() - y.createdAt.getTime()
      : x.transactionId < y.transactionId
        ? -1
        : x.transactionId > y.transactionId
          ? 1
          : 0;

/**
 * Ruling P339 (S9): for each payment in `wanted`, what it did between its two people, computed on read (D7). Replays
 * the space's movements in its history's order with the P323 pairwise rule and reads the pair's debt just before each
 * payment. Only a PAYMENT made for oneself has one: a forgiveness or a gift moves no money, and a payment made for
 * someone else (P322) settles that person's debt, not the payer's; every movement still counts for the pairs.
 * UnknownCurrency for a currency Money does not know.
 */
export const settlementContexts = (
  currency: string,
  movements: DatedDebtMovements,
  wanted: ReadonlySet<string>,
): Result<Map<string, SettlementContext>> => {
  const known = currencyOf(currency);
  if (!known.ok) return known;
  type Step = { readonly place: DebtPlace } & (
    | { readonly expense: OneCurrencyDebtExpense }
    | { readonly settlement: OneCurrencyDebtSettlement & DebtPlace }
  );
  const history: Step[] = [
    ...movements.expenses.map((expense) => ({ place: expense, expense })),
    ...movements.settlements.map((settlement) => ({ place: settlement, settlement })),
  ].sort((x, y) => inHistoryOrder(x.place, y.place));
  const pairs = new PairLedger();
  const found = new Map<string, SettlementContext>();
  for (const step of history) {
    if ("expense" in step) {
      const owed = oweExpense(currency, step.expense, pairs);
      if (!owed.ok) return owed;
      continue;
    }
    const { settlement } = step;
    if (
      wanted.has(settlement.transactionId) &&
      settlement.reason === "PAYMENT" &&
      settlement.onBehalfOfMemberId === null
    ) {
      const debt = pairs.owedBy(settlement.payerMemberId, settlement.receivingMemberId);
      const paid = debt <= 0n ? 0n : debt < settlement.amount ? debt : settlement.amount;
      const lent = settlement.amount - paid;
      found.set(settlement.transactionId, {
        kind: lent === 0n ? "PAID" : paid === 0n ? "LENT" : "PAID_AND_LENT",
        paid,
        lent,
      });
    }
    oweSettlement(settlement, pairs);
  }
  return ok(found);
};
