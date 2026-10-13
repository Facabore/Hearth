import { getContainer } from "@/composition/container";
import { defineRoute, withIdempotency } from "@/composition/route";
import {
  RecordExpenseBodySchema,
  transactionDto,
  transactionHeaders,
} from "@/modules/ledger/contracts/ledger.contract";
import { moneyFromDto, optionalLocalDate } from "@/shared/http/contracts";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: RecordExpenseBodySchema,
  before: withIdempotency,
  handler: async ({ user, params, body }) => {
    const amount = moneyFromDto(body.amount);
    if (!amount.ok) return amount;
    const date = optionalLocalDate(body.date);
    if (!date.ok) return date;
    const result = await getContainer().ledger.recordExpense({
      spaceId: params.spaceId!,
      userId: user!.id,
      description: body.description,
      date: date.value,
      categoryId: body.categoryId,
      amount: amount.value,
      accountId: body.accountId,
    });
    return result.ok
      ? ok({ status: 201, body: transactionDto(result.value), headers: transactionHeaders(result.value) })
      : result;
  },
});
