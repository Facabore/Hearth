import type { LocalDate } from "@/shared/kernel";

/** Ruling P238 (M6c): a scheduled movement of one of the caller's spaces (the ledger's `ScheduledMovement`, by shape). */
export interface PlannedMovement {
  readonly spaceId: string;
  readonly spaceName: string;
  readonly recurrenceId: string;
  readonly occurrenceId: string | null;
  readonly type: "EXPENSE" | "INCOME" | "TRANSFER" | "FUND_CONTRIBUTION";
  readonly description: string;
  /** When it is due: a schedule date, or the date a PENDING occurrence was due. */
  readonly date: LocalDate;
  readonly status: "SCHEDULED" | "PENDING";
  readonly estimated: boolean;
  readonly amount: bigint;
  readonly currency: string;
  readonly debitAccountId: string | null;
  readonly creditAccountId: string | null;
}

/** One of the caller's own accounts; `counted` when it counts in their available money (HU-E2-07, P51). */
export interface OwnAccount {
  readonly id: string;
  readonly counted: boolean;
}

/** Ruling P240: the signed change of the caller's available money. */
export interface CashFlowMovement extends PlannedMovement {
  readonly effect: bigint;
}

export interface CashFlowDate {
  readonly date: LocalDate;
  readonly movements: readonly CashFlowMovement[];
  /** The available money after every movement of the date. */
  readonly balanceAfter: bigint;
}

export interface CashFlowProjection {
  readonly dates: readonly CashFlowDate[];
  readonly totals: { readonly incoming: bigint; readonly outgoing: bigint; readonly closing: bigint };
  /** The lowest projected balance and its first date; today's opening when nothing goes lower. */
  readonly lowest: { readonly date: LocalDate; readonly balance: bigint };
  readonly otherCurrencySpaces: readonly {
    readonly spaceId: string;
    readonly name: string;
    readonly currency: string;
  }[];
}

export interface CashFlowInput {
  readonly today: LocalDate;
  readonly through: LocalDate;
  /** The personal space's currency, every sum's (D6). */
  readonly currency: string;
  /** Today's available money of the personal space (HU-E2-07). */
  readonly opening: bigint;
  readonly accounts: readonly OwnAccount[];
  readonly movements: readonly PlannedMovement[];
}

const order = (
  a: { date: LocalDate; movement: PlannedMovement },
  b: { date: LocalDate; movement: PlannedMovement },
) => {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.movement.status !== b.movement.status) return a.movement.status === "PENDING" ? -1 : 1;
  return a.movement.date < b.movement.date ? -1 : a.movement.date > b.movement.date ? 1 : 0;
};

/**
 * #150, rulings P239 and P240 (M6c): the caller's movements through `through`, each placed on its date or, when it
 * was due earlier (a PENDING occurrence, a date the scheduler has not reached), on today. A movement is the caller's
 * when it debits or credits one of their own accounts. Its effect is +amount into a counted account, −amount out of
 * one, so 0 between two counted accounts or two uncounted ones. A movement in another currency is left out and its
 * space named once (ruling P37's rule). Derived on read (D7); ties keep the input order.
 */
export const cashFlow = (input: CashFlowInput): CashFlowProjection => {
  const counted = new Map(input.accounts.map((account) => [account.id, account.counted]));
  const others = new Map<string, { spaceId: string; name: string; currency: string }>();
  const placed: { date: LocalDate; movement: CashFlowMovement }[] = [];
  for (const movement of input.movements) {
    if (movement.date > input.through) continue;
    const debit = movement.debitAccountId === null ? undefined : counted.get(movement.debitAccountId);
    const credit = movement.creditAccountId === null ? undefined : counted.get(movement.creditAccountId);
    if (debit === undefined && credit === undefined) continue;
    if (movement.currency !== input.currency) {
      others.set(movement.spaceId, {
        spaceId: movement.spaceId,
        name: movement.spaceName,
        currency: movement.currency,
      });
      continue;
    }
    const effect = (credit ? movement.amount : 0n) - (debit ? movement.amount : 0n);
    placed.push({
      date: movement.date < input.today ? input.today : movement.date,
      movement: { ...movement, effect },
    });
  }
  placed.sort(order);
  const dates: CashFlowDate[] = [];
  let balance = input.opening;
  let incoming = 0n;
  let outgoing = 0n;
  let lowest = { date: input.today, balance: input.opening };
  for (const { date, movement } of placed) {
    balance += movement.effect;
    if (movement.effect > 0n) incoming += movement.effect;
    else outgoing -= movement.effect;
    const last = dates.at(-1);
    if (last?.date === date)
      dates[dates.length - 1] = { date, movements: [...last.movements, movement], balanceAfter: balance };
    else dates.push({ date, movements: [movement], balanceAfter: balance });
  }
  for (const { date, balanceAfter } of dates)
    if (balanceAfter < lowest.balance) lowest = { date, balance: balanceAfter };
  return {
    dates,
    totals: { incoming, outgoing, closing: input.opening + incoming - outgoing },
    lowest,
    otherCurrencySpaces: [...others.values()],
  };
};
