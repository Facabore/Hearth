import { getContainer } from "@/composition/container";
import { defineRoute, withIdempotency } from "@/composition/route";
import {
  RecordAdjustmentBodySchema,
  transactionDto,
  transactionHeaders,
  whenFromBody,
} from "@/modules/ledger/contracts/ledger.contract";
import { moneyFromDto } from "@/shared/http/contracts";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** Design Q4 (#329): a balance adjustment of one account, with a signed amount in that account's own currency. */
export const POST = defineRoute({
  auth: "required",
  body: RecordAdjustmentBodySchema,
  before: withIdempotency,
  handler: async ({ user, params, body }) => {
    const amount = moneyFromDto(body.amount);
    if (!amount.ok) return amount;
    const when = whenFromBody(body);
    if (!when.ok) return when;
    const result = await getContainer().ledger.recordAdjustment({
      spaceId: params.spaceId!,
      userId: user!.id,
      description: body.description,
      ...when.value,
      amount: amount.value,
      accountId: body.accountId,
    });
    return result.ok
      ? ok({ status: 201, body: transactionDto(result.value), headers: transactionHeaders(result.value) })
      : result;
  },
});
