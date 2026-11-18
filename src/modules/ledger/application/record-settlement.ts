import type { LocalDate, Money, Result } from "@/shared/kernel";
import { domainError, err, ok } from "@/shared/kernel";
import {
  giveAway,
  mayForgive,
  positiveAmount,
  recordSettlement,
  withLegs,
  type AccountLeg,
  type Settlement,
} from "../domain/transaction";
import { authorizeWriter, openPeriod, partyAccount } from "./checks";
import type { LedgerDeps } from "./deps";
import { recordedLegOf } from "./foreign-amount";
import { whenOf, type WhenInput } from "./when";

export interface RecordSettlementInput extends Omit<WhenInput, "userId"> {
  readonly spaceId: string;
  readonly userId: string;
  readonly description?: string;
  /** P342 (S5): in any currency, the debt's by default; the settlement is stored in it and settles that currency. */
  readonly amount: Money;
  /**
   * P342 (S5): what the source account really moved, in its own currency, when it is not the settlement's: the explicit
   * exchange ("Saldar 50 USD con 205.000 COP"). Suggested from the date's rate when absent.
   */
  readonly sourceAmount?: Money;
  /** P342 (S5): what really reached the destination account, in its own currency, when it is not the settlement's. */
  readonly destinationAmount?: Money;
  /** The member who paid, registered or guest. */
  readonly payerMemberId: string;
  /** The member who received the money. */
  readonly receivingMemberId: string;
  /** Optional: the payer's own account; never for a guest. */
  readonly sourceAccountId?: string | null;
  /** Optional: the receiving member's own account; never for a guest. */
  readonly destinationAccountId?: string | null;
  /** Ruling P322: the member whose debt the payer paid; a current member who is neither party. */
  readonly onBehalfOfMemberId?: string | null;
  /** Ruling P322: with `onBehalfOfMemberId`, the payer gives the payment away (a linked GIFT). */
  readonly gift?: boolean;
  /** Ruling P322: FORGIVENESS when the receiver forgives the payer's debt; PAYMENT when absent. */
  readonly reason?: "PAYMENT" | "FORGIVENESS";
}

export type RecordSettlement = (input: RecordSettlementInput) => Promise<Result<Settlement>>;

/**
 * P342 (S5), owner 2026-11-18 ("Pedir una cuenta en esa moneda"): a settlement paid in another currency than its own is
 * an explicit exchange, recorded as the leg of one of the recorder's accounts in that other currency. A leg given in
 * another currency with no account on its side, on an account in a third currency, or on an account that is not the
 * recorder's is ExchangeAccountRequired (`currency`: the leg's). Anything else is `recordedLegOf`'s: no leg on an account
 * in the settlement's currency, the given leg, or the date's rate as the suggestion (ExchangeRateRequired without one).
 */
const settlementLegOf = async (
  deps: Pick<LedgerDeps, "accounts" | "rates">,
  userId: string,
  accountId: string | null,
  amount: Money,
  accountAmount: Money | undefined,
  date: LocalDate,
): Promise<Result<AccountLeg | null>> => {
  if (accountAmount !== undefined && accountAmount.currency.code !== amount.currency.code) {
    const currency = accountAmount.currency.code;
    const account = accountId === null ? null : await deps.accounts.find(accountId);
    if (account === null || account.currency !== currency || account.ownerUserId !== userId) {
      return err(domainError("ExchangeAccountRequired", { currency }));
    }
  }
  return recordedLegOf(deps, accountId, amount, accountAmount, date);
};

/**
 * HU-E5-02: any member who records money may record a settlement, also on a guest's behalf (D15). Ruling P322: also a
 * payment of a third member's debt, given away or not, and the receiver's forgiveness of a debt. P342 (S5): stored in
 * its own currency; a gift's half and a payment for someone stay in it, and only an account leg exchanges.
 */
export const createRecordSettlement =
  (deps: LedgerDeps): RecordSettlement =>
  (input) =>
    deps.tm.run(async () => {
      const writer = await authorizeWriter(deps, input.spaceId, input.userId);
      if (!writer.ok) return writer;
      const space = writer.value;
      const amount = positiveAmount(input.amount.minor);
      if (!amount.ok) return amount;
      const members = await deps.members.listCurrent(space.spaceId);
      // D9: the payer's account is debited, so only its owner records it; the receiver's is credited.
      const source = await partyAccount(deps, members, input.payerMemberId, input.sourceAccountId ?? null, {
        required: false,
        debitedBy: input.userId,
      });
      if (!source.ok) return source;
      const destination = await partyAccount(
        deps,
        members,
        input.receivingMemberId,
        input.destinationAccountId ?? null,
        { required: false, debitedBy: null },
      );
      if (!destination.ok) return destination;
      // HU-E4-14: the recorder's zone unless the request names one (ruling P41).
      const when = await whenOf(deps, input);
      if (!when.ok) return when;
      const { date, occurredAt, timeZone } = when.value;
      const open = await openPeriod(deps, space.spaceId, date);
      if (!open.ok) return open;
      const recorded = recordSettlement({
        id: deps.ids.next<"Transaction">(),
        spaceId: space.spaceId,
        description: input.description,
        date,
        amount: amount.value,
        currency: input.amount.currency.code,
        createdBy: input.userId,
        occurredAt,
        timeZone,
        now: deps.clock.now(),
        payerMemberId: input.payerMemberId,
        receivingMemberId: input.receivingMemberId,
        sourceAccountId: source.value,
        destinationAccountId: destination.value,
        reason: input.reason,
        onBehalfOfMemberId: input.onBehalfOfMemberId,
        gift: input.gift,
      });
      if (!recorded.ok) return recorded;
      // P342 (S5): each account's leg in its own currency whenever it is not the settlement's (the rate is a read inside
      // the held space lock, #89).
      const legOf = (accountId: string | null, accountAmount: Money | undefined) =>
        settlementLegOf(deps, input.userId, accountId, input.amount, accountAmount, date);
      const sourceLeg = await legOf(source.value, input.sourceAmount);
      if (!sourceLeg.ok) return sourceLeg;
      const destinationLeg = await legOf(destination.value, input.destinationAmount);
      if (!destinationLeg.ok) return destinationLeg;
      const settlement = withLegs(recorded.value, {
        source: sourceLeg.value,
        destination: destinationLeg.value,
      }) as Result<Settlement>;
      if (!settlement.ok) return settlement;
      const { onBehalfOfMemberId, reason } = settlement.value;
      if (onBehalfOfMemberId !== null && !members.some((m) => m.id === onBehalfOfMemberId)) {
        return err(domainError("InvalidOnBehalfOf"));
      }
      if (reason === "FORGIVENESS") {
        const receiver = members.find((m) => m.id === input.receivingMemberId)!;
        if (!mayForgive(receiver, { userId: input.userId, role: space.role })) {
          return err(domainError("ForgivenessNotAllowed"));
        }
      }
      if (input.gift !== true) {
        await deps.transactions.add(settlement.value);
        return settlement;
      }
      // Ruling P322: both halves of a gift in one statement, so neither is ever stored alone.
      const halves = giveAway(settlement.value, deps.ids.next<"Transaction">());
      if (!halves.ok) return halves;
      await deps.transactions.add(...halves.value);
      return ok(halves.value[0]);
    });
