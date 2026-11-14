import type { LocalDate } from "@/shared/kernel";
import type { AccountMovement } from "../domain/account-flows";

/** Ruling P327: an account's movements, read from the ledger and the accounts on read (D7); bound by the composition root. */
export interface AccountMovements {
  /** The space the account belongs to, archived accounts included; null for an unknown or malformed id. */
  spaceOf(accountId: string): Promise<string | null>;
  /** Every live movement of `spaceIds` within [from, to] that the account paid, received or moved (P277). */
  movementsOf(
    accountId: string,
    spaceIds: readonly string[],
    from: LocalDate,
    to: LocalDate,
  ): Promise<readonly AccountMovement[]>;
}

/** Ruling P327: what an account did in the period besides its spending, which the breakdown itself holds. */
export interface AccountFigures {
  readonly id: string;
  readonly in: bigint;
  readonly out: bigint;
  readonly movedToOwnAccounts: bigint;
}
