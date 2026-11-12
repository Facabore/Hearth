import type { Money, Result } from "@/shared/kernel";
import { domainError, err, ok } from "@/shared/kernel";
import {
  giveAway,
  mayForgive,
  positiveAmount,
  recordSettlement,
  type Settlement,
} from "../domain/transaction";
import { authorizeWriter, inSpaceCurrency, openPeriod, partyAccount } from "./checks";
import type { LedgerDeps } from "./deps";
import { whenOf, type WhenInput } from "./when";

export interface RecordSettlementInput extends Omit<WhenInput, "userId"> {
  readonly spaceId: string;
  readonly userId: string;
  readonly description?: string;
  readonly amount: Money;
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
 * HU-E5-02: any member who records money may record a settlement, also on a guest's behalf (D15). Ruling P322: also a
 * payment of a third member's debt, given away or not, and the receiver's forgiveness of a debt.
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
      const currency = inSpaceCurrency(space, input.amount);
      if (!currency.ok) return currency;
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
      const settlement = recordSettlement({
        id: deps.ids.next<"Transaction">(),
        spaceId: space.spaceId,
        description: input.description,
        date,
        amount: amount.value,
        currency: space.currency,
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
