import { getContainer } from "@/composition/container";
import { defineRoute, withIdempotency } from "@/composition/route";
import {
  RecordTransferBodySchema,
  transactionDto,
  transactionHeaders,
  whenFromBody,
} from "@/modules/ledger/contracts/ledger.contract";
import { moneyFromDto } from "@/shared/http/contracts";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: RecordTransferBodySchema,
  before: withIdempotency,
  handler: async ({ user, params, body }) => {
    const amount = moneyFromDto(body.amount);
    if (!amount.ok) return amount;
    const when = whenFromBody(body);
    if (!when.ok) return when;
    const result = await getContainer().ledger.recordTransfer({
      spaceId: params.spaceId!,
      userId: user!.id,
      description: body.description,
      ...when.value,
      amount: amount.value,
      sourceAccountId: body.sourceAccountId,
      destinationAccountId: body.destinationAccountId,
    });
    return result.ok
      ? ok({ status: 201, body: transactionDto(result.value), headers: transactionHeaders(result.value) })
      : result;
  },
});
