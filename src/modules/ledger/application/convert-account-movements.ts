import type { SpaceLocks } from "@/modules/spaces/application";
import {
  domainError,
  err,
  ok,
  type Clock,
  type ExchangeRate,
  type IdGenerator,
  type LocalDate,
  type Result,
} from "@/shared/kernel";
import { accountMovement, convertedForAccount } from "../domain/account-conversion";
import { changesBetween, type Transaction } from "../domain/transaction";
import type { AccountMovementSource, AuditLog, ClosedPeriodGuard, TransactionRepository } from "./ports";

export interface ConvertAccountMovementsDeps {
  readonly movements: AccountMovementSource;
  readonly transactions: Pick<TransactionRepository, "save">;
  readonly audit: Pick<AuditLog, "append">;
  readonly closedPeriods: ClosedPeriodGuard;
  /**
   * Ruling P336: every space the account moves money in is held as a currency change holds its space (FOR NO KEY
   * UPDATE), so no movement is recorded with the account's old currency while it changes.
   */
  readonly spaceLocks: Pick<SpaceLocks, "lockForLifecycle">;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export interface AccountMovementsConversion {
  readonly accountId: string;
  /** The account's own space, already locked by the caller. */
  readonly accountSpaceId: string;
  readonly from: string;
  readonly to: string;
  /** Null only for a dry run with no rate yet: the movements are counted, not converted. */
  readonly rate: ExchangeRate | null;
  readonly actorUserId: string;
  /** A dry run writes and locks nothing; it says what the change would do. */
  readonly dryRun: boolean;
}

export interface ConvertedMovements {
  readonly movements: number;
  /** What the movements moved the account by, in `from`. */
  readonly netBefore: bigint;
  /** The same after the change, in `to`; null without a rate. */
  readonly netAfter: bigint | null;
}

export type ConvertAccountMovements = (
  input: AccountMovementsConversion,
) => Promise<Result<ConvertedMovements>>;

/**
 * Ruling P336: converts what every live movement moved an account by into its new currency at the rate, and keeps an
 * audit entry for each movement it changes (D8). Runs inside the caller's database transaction.
 */
export const createConvertAccountMovements =
  (deps: ConvertAccountMovementsDeps): ConvertAccountMovements =>
  async (input) => {
    if (!input.dryRun) {
      if (input.rate === null) return err(domainError("InvalidExchangeRate"));
      // In id order, the order every change of this kind locks in; the caller already holds the account's own space.
      for (const spaceId of await deps.movements.spacesWith(input.accountId)) {
        if (spaceId !== input.accountSpaceId) await deps.spaceLocks.lockForLifecycle(spaceId);
      }
    }
    const movements = await deps.movements.movementsOf(input.accountId);
    const netBefore = movements.reduce((sum, tx) => sum + accountMovement(tx, input.accountId), 0n);
    if (input.rate === null) return ok({ movements: movements.length, netBefore, netAfter: null });
    const closed = await closedDatesOf(deps.closedPeriods, input.accountSpaceId, movements);
    const conversion = {
      accountId: input.accountId,
      accountSpaceId: input.accountSpaceId,
      from: input.from,
      to: input.to,
      rate: input.rate,
      periodOpen: (date: LocalDate) => !closed.has(date),
    };
    const now = deps.clock.now();
    let netAfter = 0n;
    for (const current of movements) {
      const revised = convertedForAccount(current, conversion);
      if (!revised.ok) return revised;
      netAfter += accountMovement(revised.value, input.accountId);
      if (input.dryRun) continue;
      const written = await saved(
        deps,
        current,
        { ...revised.value, updatedAt: now },
        input.actorUserId,
        now,
      );
      if (!written.ok) return written;
    }
    return ok({ movements: movements.length, netBefore, netAfter });
  };

/** HU-E4-06: the dates of the account's own space in a closed plan period, whose movements keep their amounts. */
const closedDatesOf = async (
  guard: ClosedPeriodGuard,
  spaceId: string,
  movements: readonly Transaction[],
): Promise<Set<LocalDate>> => {
  const dates = new Set(movements.filter((tx) => tx.spaceId === spaceId).map((tx) => tx.date));
  const closed = new Set<LocalDate>();
  for (const date of dates) if (await guard.isClosed(spaceId, date)) closed.add(date);
  return closed;
};

const saved = async (
  deps: ConvertAccountMovementsDeps,
  current: Transaction,
  revised: Transaction,
  actorUserId: string,
  now: Date,
): Promise<Result<void>> => {
  // The movement was read with the account's old currency, so the audit says what it was in and what it is in now.
  const changes = changesBetween(current, revised);
  if (Object.keys(changes).length === 0) return ok(undefined);
  if (!(await deps.transactions.save(revised, current.version)))
    return err(domainError("PreconditionFailed"));
  await deps.audit.append({
    id: deps.ids.next<"AuditEntry">(),
    transactionId: current.id,
    action: "UPDATED",
    actorUserId,
    at: now,
    changes,
  });
  return ok(undefined);
};
