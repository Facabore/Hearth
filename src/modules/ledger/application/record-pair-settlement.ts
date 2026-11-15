import type { Result } from "@/shared/kernel";
import type { Settlement } from "../domain/transaction";
import { authorizeWriter, pairCounterpart } from "./checks";
import type { LedgerDeps } from "./deps";
import type { RecordSettlement, RecordSettlementInput } from "./record-settlement";

/**
 * P334: a transfer to someone (TO: the recorder pays them from their account) or from someone (FROM: they pay the
 * recorder into it), in a two-member space whose member ids the client cannot know before the space exists.
 */
export type RecordPairSettlementInput = Pick<
  RecordSettlementInput,
  "spaceId" | "userId" | "description" | "date" | "occurredAt" | "timeZone" | "amount"
> & {
  readonly direction: "TO" | "FROM";
  /** The recorder's own account: the source of what they gave, or where what they got went. */
  readonly accountId: string;
};

export type RecordPairSettlement = (input: RecordPairSettlementInput) => Promise<Result<Settlement>>;

/**
 * P334: records the transfer as P322's settlement between the recorder and the other member of the space, with the
 * recorder's account on their side and none on the other's. The writer takes the space's lock before the members are
 * read (issue #89); RecordSettlement keeps every rule of its own (accounts, periods, amounts).
 */
export const createRecordPairSettlement =
  (
    deps: Pick<LedgerDeps, "access" | "spaceLocks" | "members">,
    recordSettlement: RecordSettlement,
  ): RecordPairSettlement =>
  async ({ direction, accountId, ...input }) => {
    const writer = await authorizeWriter(deps, input.spaceId, input.userId);
    if (!writer.ok) return writer;
    const other = await pairCounterpart(deps, writer.value);
    if (!other.ok) return other;
    const me = writer.value.memberId;
    return recordSettlement({
      ...input,
      ...(direction === "TO"
        ? { payerMemberId: me, receivingMemberId: other.value, sourceAccountId: accountId }
        : { payerMemberId: other.value, receivingMemberId: me, destinationAccountId: accountId }),
    });
  };
