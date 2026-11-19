import type { SpaceMember, SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, flatMap, map, Money, ok, type LocalDate, type Result } from "@/shared/kernel";
import { splitShares, type SplitInput } from "../domain/split";
import { mayForgive, type Payment, type Share, type Transaction } from "../domain/transaction";
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
  /**
   * D29: a new amount, read as recording its type reads it: an expense's or income's in any currency, an own
   * transfer's ("Sale") in the source account's, the others' in the space's base currency.
   */
  readonly amount?: Money;
  /** D29: with a new amount in another currency, the real base amount the bank charged; it wins over the rate. */
  readonly convertedAmount?: Money;
  /** D29: with a new amount on a cross-currency own transfer, what arrived ("Llega"); it wins over the rate. */
  readonly destinationAmount?: Money;
  /**
   * Ruling P186: on an expense, the requester pays all of it from this account of theirs (HU-E4-01's shorthand);
   * on an income, the receiving account. Not with `payments`.
   */
  readonly accountId?: string;
  /** Ruling P186: who paid an expense, as when recording (spec 5.2, D9). */
  readonly payments?: readonly PaymentInput[];
  /**
   * Ruling P186: an own transfer's accounts. P344 (S2): also a settlement's (source: the payer's, destination: the
   * receiver's) and a fund contribution's source, on the editor's own side only; null leaves that side with none.
   */
  readonly sourceAccountId?: string | null;
  readonly destinationAccountId?: string | null;
  /** P344 (S4): a settlement's or a fund contribution's payer, another current member. */
  readonly payerMemberId?: string;
  /** P344 (S4): a settlement's receiver, another current member. */
  readonly receivingMemberId?: string;
  /** Ruling P186: how an expense is split, recomputed on the edited amount among the current members. */
  readonly split?: SplitInput;
}

export interface PartChanges {
  readonly payments?: readonly Payment[];
  readonly shares?: readonly Share[];
  readonly sourceAccountId?: string | null;
  readonly destinationAccountId?: string | null;
  readonly payerMemberId?: string;
  readonly receivingMemberId?: string;
}

type PartField =
  | "accountId"
  | "payments"
  | "sourceAccountId"
  | "destinationAccountId"
  | "split"
  | "payerMemberId"
  | "receivingMemberId";
const notEditable = (field: PartField): Result<never> => err(domainError("FieldNotEditable", { field }));
/** The first part of `fields` the request sends, if any. */
const sent = (changes: EditChanges, fields: readonly PartField[]): PartField | undefined =>
  fields.find((field) => changes[field] !== undefined);

/** P344: one side of a settlement or a fund contribution, its member and the account it moves, if any. */
interface Side {
  readonly memberId: string;
  readonly accountId: string | null;
}

/**
 * P344 (S2, S3): a settlement's or a fund contribution's side after an edit. Its member is any current member
 * (NotASpaceMember otherwise). The editor names an account of their own (D9: owned, not archived), or none, only on
 * their own side; on another member's side they choose only the member: a side moved to another member has no
 * account, one whose member stays keeps its own, and any other account is refused (GuestHasNoAccounts for a guest,
 * AccountNotOwned for anyone else).
 */
const editedSide = async (
  deps: Pick<LedgerDeps, "accounts">,
  space: SpaceMembership,
  members: readonly SpaceMember[],
  userId: string,
  current: Side,
  memberId: string | undefined,
  accountId: string | null | undefined,
): Promise<Result<Side>> => {
  const member = memberId ?? current.memberId;
  const moved = member !== current.memberId;
  if (moved && !members.some((m) => m.id === member)) return err(domainError("NotASpaceMember"));
  const kept = moved ? null : current.accountId;
  if (accountId === undefined || accountId === kept) return ok({ memberId: member, accountId: kept });
  if (member !== space.memberId) {
    const guest = members.find((m) => m.id === member)?.userId === null;
    return err(domainError(guest && accountId !== null ? "GuestHasNoAccounts" : "AccountNotOwned"));
  }
  if (accountId === null) return ok({ memberId: member, accountId: null });
  return map(await ownAccount(deps, accountId, userId), (account) => ({
    memberId: member,
    accountId: account.id,
  }));
};

/** P344: what an edited side changes, its member and its account each only when they differ. */
const sideChanges = (
  current: Side,
  edited: Side,
  memberField: "payerMemberId" | "receivingMemberId",
  accountField: "sourceAccountId" | "destinationAccountId",
): PartChanges => {
  const parts: { -readonly [K in keyof PartChanges]: PartChanges[K] } = {};
  if (edited.memberId !== current.memberId) parts[memberField] = edited.memberId;
  if (edited.accountId !== current.accountId) parts[accountField] = edited.accountId;
  return parts;
};

/**
 * Ruling P186, P344: the money parts an edit replaces, checked as when recording (spec 5.2, D9). A new account is the
 * editor's own (S2); another member's side takes only a member (S3): an expense's payment keeps the account it has
 * while its member stays, an income's account moves only by its receiver and an own transfer's only by its creator,
 * and a settlement's members and a fund contribution's payer change to other current members (S4, P188 lifted). A
 * changed debit on another member's account is a correction the audit keeps (D8), not a refusal.
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
      const wrong = sent(changes, [
        "sourceAccountId",
        "destinationAccountId",
        "payerMemberId",
        "receivingMemberId",
      ]);
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
        const resolved = await resolvePayments(
          deps,
          space,
          members,
          requested,
          userId,
          space.currency,
          current.payments,
        );
        if (!resolved.ok) return resolved;
        payments = resolved.value;
      }
      return ok({ ...(shares ? { shares } : {}), ...(payments ? { payments } : {}) });
    }
    case "INCOME": {
      const wrong = sent(changes, [
        "payments",
        "split",
        "sourceAccountId",
        "destinationAccountId",
        "payerMemberId",
        "receivingMemberId",
      ]);
      if (wrong) return notEditable(wrong);
      if (changes.accountId === undefined) return ok({});
      // P344 (S3): the receiver's side; anyone else may only send back the account it already has.
      if (current.receivingMemberId !== space.memberId) {
        return changes.accountId === current.destinationAccountId
          ? ok({})
          : err(domainError("AccountNotOwned"));
      }
      const account = flatMap(await ownAccount(deps, changes.accountId, userId), (a) =>
        accountInSpace(a, space.spaceId),
      );
      return map(account, (a) => ({ destinationAccountId: a.id }));
    }
    case "TRANSFER": {
      const wrong = sent(changes, ["accountId", "payments", "split", "receivingMemberId"]);
      if (wrong) return notEditable(wrong);
      if (current.payerMemberId !== null) {
        // HU-E4-09: a contribution keeps the fund it went into; P344 (S4): its payer and their source change.
        if (changes.destinationAccountId !== undefined) return notEditable("destinationAccountId");
        if (changes.payerMemberId === undefined && changes.sourceAccountId === undefined) return ok({});
        const members = await deps.members.listCurrent(space.spaceId);
        const before = { memberId: current.payerMemberId, accountId: current.sourceAccountId };
        const after = await editedSide(
          deps,
          space,
          members,
          userId,
          before,
          changes.payerMemberId,
          changes.sourceAccountId,
        );
        return map(after, (side) => sideChanges(before, side, "payerMemberId", "sourceAccountId"));
      }
      if (changes.payerMemberId !== undefined) return notEditable("payerMemberId");
      // P344 (S2, S3): an own transfer's accounts are its creator's; anyone else may only send back the ones it has.
      const parts: { sourceAccountId?: string; destinationAccountId?: string } = {};
      for (const field of ["sourceAccountId", "destinationAccountId"] as const) {
        const id = changes[field];
        if (id === undefined || id === current[field]) continue;
        if (current.createdBy !== userId) return err(domainError("AccountNotOwned"));
        if (id === null) return err(domainError("AccountRequired"));
        const account = flatMap(await ownAccount(deps, id, userId), (a) => accountInSpace(a, space.spaceId));
        if (!account.ok) return account;
        parts[field] = account.value.id;
      }
      return ok(parts);
    }
    case "SETTLEMENT": {
      const wrong = sent(changes, ["accountId", "payments", "split"]);
      if (wrong) return notEditable(wrong);
      const moving = sent(changes, [
        "payerMemberId",
        "receivingMemberId",
        "sourceAccountId",
        "destinationAccountId",
      ]);
      if (!moving) return ok({});
      // P344 (S4): its payer and its receiver, each with the account on their side.
      const members = await deps.members.listCurrent(space.spaceId);
      const payer = { memberId: current.payerMemberId, accountId: current.sourceAccountId };
      const receiver = { memberId: current.receivingMemberId, accountId: current.destinationAccountId };
      const editedPayer = await editedSide(
        deps,
        space,
        members,
        userId,
        payer,
        changes.payerMemberId,
        changes.sourceAccountId,
      );
      if (!editedPayer.ok) return editedPayer;
      const editedReceiver = await editedSide(
        deps,
        space,
        members,
        userId,
        receiver,
        changes.receivingMemberId,
        changes.destinationAccountId,
      );
      if (!editedReceiver.ok) return editedReceiver;
      // Ruling P322: only the receiver forgives, so a forgiveness moves only to members its editor may forgive for.
      const parties =
        editedPayer.value.memberId !== payer.memberId || editedReceiver.value.memberId !== receiver.memberId;
      if (current.reason === "FORGIVENESS" && parties) {
        const forgiver = members.find((m) => m.id === editedReceiver.value.memberId);
        if (forgiver === undefined) return err(domainError("NotASpaceMember"));
        if (!mayForgive(forgiver, { userId, role: space.role }))
          return err(domainError("ForgivenessNotAllowed"));
      }
      return ok({
        ...sideChanges(payer, editedPayer.value, "payerMemberId", "sourceAccountId"),
        ...sideChanges(receiver, editedReceiver.value, "receivingMemberId", "destinationAccountId"),
      });
    }
    // Design Q4: an adjustment keeps its one account; delete it and record it again on another.
    case "ADJUSTMENT": {
      const wrong = sent(changes, [
        "accountId",
        "payments",
        "split",
        "sourceAccountId",
        "destinationAccountId",
        "payerMemberId",
        "receivingMemberId",
      ]);
      return wrong ? notEditable(wrong) : ok({});
    }
  }
};
