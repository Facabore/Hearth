import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  ListTransactionsQuerySchema,
  positionFromCursor,
  transactionPageDto,
} from "@/modules/ledger/contracts/ledger.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: ListTransactionsQuerySchema,
  handler: async ({ user, params, query }) => {
    const after = query.cursor === undefined ? ok(null) : positionFromCursor(query.cursor);
    if (!after.ok) return after;
    const result = await getContainer().ledger.listTransactions({
      spaceId: params.spaceId!,
      userId: user!.id,
      period: query.period,
      categoryIds: query.categoryIds?.split(","),
      payerMemberId: query.payerMemberId,
      participantMemberId: query.participantMemberId,
      type: query.type,
      after: after.value,
      limit: query.limit,
    });
    return result.ok ? ok({ status: 200, body: transactionPageDto(result.value) }) : result;
  },
});
