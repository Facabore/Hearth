import { Money, type LocalDate } from "@/shared/kernel";
import type { SourceMovement, SourceSnapshot } from "../domain/source-snapshot";

/** Money as stored: minor units as a decimal string (a bigint does not survive JSON) and the currency code. */
interface StoredMoney {
  readonly minor: string;
  readonly currency: string;
}

type StoredMovement = Omit<SourceMovement, "amount" | "originalAmount" | "toAmount" | "occurredAt"> & {
  readonly amount: StoredMoney;
  readonly originalAmount: StoredMoney | null;
  readonly toAmount: StoredMoney | null;
  readonly occurredAt: string | null;
};

export type StoredSnapshot = Omit<SourceSnapshot, "movements"> & {
  readonly movements: readonly StoredMovement[];
};

const storedMoney = (money: Money): StoredMoney => ({
  minor: money.minor.toString(),
  currency: money.currency.code,
});

const moneyOf = (stored: StoredMoney): Money => {
  const money = Money.ofMinor(BigInt(stored.minor), stored.currency);
  // Only snapshots this codec wrote are read back, so their currencies were known when written.
  if (!money.ok) throw new Error(`stored snapshot holds an unknown currency: ${money.error.code}`);
  return money.value;
};

/** The snapshot as the batch's `snapshot` JSON column holds it (design §3.5): exact, every amount in minor units. */
export const encodeSnapshot = (snapshot: SourceSnapshot): StoredSnapshot => ({
  ...snapshot,
  movements: snapshot.movements.map((m) => ({
    ...m,
    amount: storedMoney(m.amount),
    originalAmount: m.originalAmount === null ? null : storedMoney(m.originalAmount),
    toAmount: m.toAmount === null ? null : storedMoney(m.toAmount),
    occurredAt: m.occurredAt === null ? null : m.occurredAt.toISOString(),
  })),
});

export const decodeSnapshot = (stored: StoredSnapshot): SourceSnapshot => ({
  ...stored,
  movements: stored.movements.map((m) => ({
    ...m,
    date: m.date as LocalDate,
    amount: moneyOf(m.amount),
    originalAmount: m.originalAmount === null ? null : moneyOf(m.originalAmount),
    toAmount: m.toAmount === null ? null : moneyOf(m.toAmount),
    occurredAt: m.occurredAt === null ? null : new Date(m.occurredAt),
  })),
});
