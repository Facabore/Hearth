import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  MyTransactionsQuerySchema,
  myTransactionPageDto,
  positionFromCursor,
} from "@/modules/ledger/contracts/ledger.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** Ruling P319 (#294): the personal Movimientos, the caller's movements in every current space. */
export const GET = defineRoute({
  auth: "required",
  query: MyTransactionsQuerySchema,
  handler: async ({ user, query }) => {
    const after = query.cursor === undefined ? ok(null) : positionFromCursor(query.cursor);
    if (!after.ok) return after;
    const result = await getContainer().ledger.listMyTransactions({
      userId: user!.id,
      period: query.period,
      spaceId: query.spaceId,
      categoryIds: query.categoryIds?.split(","),
      type: query.type,
      accountId: query.accountId,
      search: query.search,
      after: after.value,
      limit: query.limit,
    });
    return result.ok ? ok({ status: 200, body: myTransactionPageDto(result.value) }) : result;
  },
});
