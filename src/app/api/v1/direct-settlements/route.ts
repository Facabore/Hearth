import { getContainer } from "@/composition/container";
import { defineRoute, withIdempotency } from "@/composition/route";
import {
  DirectSettlementBodySchema,
  directSettlementDto,
  directSettlementFromBody,
  transactionHeaders,
} from "@/modules/ledger/contracts/ledger.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** P334: a transfer to or from someone, recorded as a settlement in the pair's direct space (created on first use). */
export const POST = defineRoute({
  auth: "required",
  body: DirectSettlementBodySchema,
  before: withIdempotency,
  handler: async ({ user, body }) => {
    const request = directSettlementFromBody(body);
    if (!request.ok) return request;
    const result = await getContainer().spaces.settleWithPerson({
      userId: user!.id,
      userName: user!.name,
      locale: user!.locale,
      counterpart: request.value.counterpart,
      expense: request.value.transfer,
    });
    return result.ok
      ? ok({
          status: 201,
          body: directSettlementDto(result.value),
          headers: transactionHeaders(result.value.recorded),
        })
      : result;
  },
});
