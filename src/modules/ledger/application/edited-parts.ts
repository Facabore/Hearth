import type { SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, flatMap, map, Money, ok, type LocalDate, type Result } from "@/shared/kernel";
import { splitShares, type SplitInput } from "../domain/split";
import type { Payment, Share, Transaction } from "../domain/transaction";
import { accountInSpace, ownAccount } from "./checks";
import type { LedgerDeps } from "./deps";
import { resolvePayments, type PaymentInput } from "./payments";

// Defined here, not in edit-transaction.ts, which imports this file (no import cycle).
export interface EditChanges {
  readonly description?: string;
  readonly date?: LocalDate;
  /** HU-E4-14: a new instant; null answers TimeRequired, since a time is replaced, never removed (P66). */
  readonly occurredAt?: Date | null;
  readonly timeZone?: string;
  readonly categoryId?: string;
  readonly amount?: Money;
  /**
   * Ruling P186: on an expense, the requester pays all of it from this account of theirs (HU-E4-01's shorthand);
   * on an income, the receiving account. Not with `payments`.
   */
  readonly accountId?: string;
  /** Ruling P186: who paid an expense, as when recording (spec 5.2, D9). */
  readonly payments?: readonly PaymentInput[];
  /** Ruling P186: an own transfer's accounts. */
  readonly sourceAccountId?: string;
  readonly destinationAccountId?: string;
  /** Ruling P186: how an expense is split, recomputed on the edited amount among the current members. */
  readonly split?: SplitInput;
}

export interface PartChanges {
  readonly payments?: readonly Payment[];
  readonly shares?: readonly Share[];
  readonly sourceAccountId?: string;
  readonly destinationAccountId?: string;
}

type PartField = "accountId" | "payments" | "sourceAccountId" | "destinationAccountId" | "split";
const notEditable = (field: PartField): Result<never> => err(domainError("FieldNotEditable", { field }));
/** The first part of `fields` the request sends, if any. */
const sent = (changes: EditChanges, fields: readonly PartField[]): PartField | undefined =>
  fields.find((field) => changes[field] !== undefined);

/**
 * Ruling P186: the money parts an edit replaces, checked as when recording (spec 5.2, D9): a new account is the
 * editor's own; an income moves only by its receiver and an own transfer only by its creator; settlements and fund
 * contributions keep their accounts (P188). The old accounts' changed debits are `ownedDebits`' job.
 */
export const editedParts = async (
  deps: Pick<LedgerDeps, "accounts" | "members">,
  space: SpaceMembership,
  current: Transaction,
  changes: EditChanges,
  userId: string,
): Promise<Result<PartChanges>> => {
  switch (current.type) {
    case "EXPENSE": {
      const wrong = sent(changes, ["sourceAccountId", "destinationAccountId"]);
      if (wrong) return notEditable(wrong);
      if (changes.accountId === undefined && changes.payments === undefined && changes.split === undefined) {
        return ok({});
      }
      // The edited amount, else the current one: the shorthand payment pays all of it (HU-E4-01).
      const whole =
        changes.amount === undefined ? Money.ofMinor(current.amount, current.currency) : ok(changes.amount);
      if (!whole.ok) return whole;
      const members = await deps.members.listCurrent(space.spaceId);
      let shares: Share[] | undefined;
      if (changes.split !== undefined) {
        // P186: among the current members only, so a member who left is never given a share (NotASpaceMember).
        const split = splitShares(
          whole.value,
          changes.split,
          members.map((m) => m.id),
        );
        if (!split.ok) return split;
        shares = split.value;
      }
      let payments: Payment[] | undefined;
      if (changes.accountId !== undefined || changes.payments !== undefined) {
        const requested = changes.payments ?? [
          { memberId: space.memberId, accountId: changes.accountId!, amount: whole.value },
        ];
        const resolved = await resolvePayments(deps, space, members, requested, userId);
        if (!resolved.ok) return resolved;
        payments = resolved.value;
      }
      return ok({ ...(shares ? { shares } : {}), ...(payments ? { payments } : {}) });
    }
    case "INCOME": {
      const wrong = sent(changes, ["payments", "split", "sourceAccountId", "destinationAccountId"]);
      if (wrong) return notEditable(wrong);
      if (changes.accountId === undefined) return ok({});
      if (current.receivingMemberId !== space.memberId) return err(domainError("AccountNotOwned"));
      const account = flatMap(await ownAccount(deps, changes.accountId, userId), (a) =>
        accountInSpace(a, space.spaceId),
      );
      return map(account, (a) => ({ destinationAccountId: a.id }));
    }
    case "TRANSFER":
    case "SETTLEMENT": {
      const wrong = sent(changes, ["accountId", "payments", "split"]);
      if (wrong) return notEditable(wrong);
      const moving = sent(changes, ["sourceAccountId", "destinationAccountId"]);
      if (!moving) return ok({});
      // P188: a settlement's and a fund contribution's accounts belong to their parties; delete and record again.
      if (current.type === "SETTLEMENT" || current.payerMemberId !== null) return notEditable(moving);
      if (current.createdBy !== userId) return err(domainError("AccountNotOwned"));
      const parts: { sourceAccountId?: string; destinationAccountId?: string } = {};
      for (const field of ["sourceAccountId", "destinationAccountId"] as const) {
        const id = changes[field];
        if (id === undefined) continue;
        const account = flatMap(await ownAccount(deps, id, userId), (a) => accountInSpace(a, space.spaceId));
        if (!account.ok) return account;
        parts[field] = account.value.id;
      }
      return ok(parts);
    }
  }
};
