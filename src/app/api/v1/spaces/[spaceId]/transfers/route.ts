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
    // D29, section 4.1: "Llega" in the destination account's own currency, when the person gave one.
    let destinationAmount: typeof amount.value | undefined;
    if (body.destinationAmount !== undefined) {
      const arrive = moneyFromDto(body.destinationAmount);
      if (!arrive.ok) return arrive;
      destinationAmount = arrive.value;
    }
    const result = await getContainer().ledger.recordTransfer({
      spaceId: params.spaceId!,
      userId: user!.id,
      description: body.description,
      ...when.value,
      amount: amount.value,
      ...(destinationAmount === undefined ? {} : { destinationAmount }),
      sourceAccountId: body.sourceAccountId,
      destinationAccountId: body.destinationAccountId,
    });
    return result.ok
      ? ok({ status: 201, body: transactionDto(result.value), headers: transactionHeaders(result.value) })
      : result;
  },
});
