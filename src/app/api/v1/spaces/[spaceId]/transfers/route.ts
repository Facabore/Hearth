import { getContainer } from "@/composition/container";
import { defineRoute, withIdempotency } from "@/composition/route";
import {
  RecordTransferBodySchema,
  transactionDto,
  transactionHeaders,
} from "@/modules/ledger/contracts/ledger.contract";
import { moneyFromDto, optionalLocalDate } from "@/shared/http/contracts";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: RecordTransferBodySchema,
  before: withIdempotency,
  handler: async ({ user, params, body }) => {
    const amount = moneyFromDto(body.amount);
    if (!amount.ok) return amount;
    const date = optionalLocalDate(body.date);
    if (!date.ok) return date;
    const result = await getContainer().ledger.recordTransfer({
      spaceId: params.spaceId!,
      userId: user!.id,
      description: body.description,
      date: date.value,
      amount: amount.value,
      sourceAccountId: body.sourceAccountId,
      destinationAccountId: body.destinationAccountId,
    });
    return result.ok
      ? ok({ status: 201, body: transactionDto(result.value), headers: transactionHeaders(result.value) })
      : result;
  },
});
