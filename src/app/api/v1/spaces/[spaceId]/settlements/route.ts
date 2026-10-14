import { getContainer } from "@/composition/container";
import { defineRoute, withIdempotency } from "@/composition/route";
import {
  RecordSettlementBodySchema,
  settlementFromBody,
  transactionDto,
  transactionHeaders,
} from "@/modules/ledger/contracts/ledger.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: RecordSettlementBodySchema,
  before: withIdempotency,
  handler: async ({ user, params, body }) => {
    const fields = settlementFromBody(body);
    if (!fields.ok) return fields;
    const result = await getContainer().ledger.recordSettlement({
      spaceId: params.spaceId!,
      userId: user!.id,
      ...fields.value,
    });
    return result.ok
      ? ok({ status: 201, body: transactionDto(result.value), headers: transactionHeaders(result.value) })
      : result;
  },
});
