import { getContainer } from "@/composition/container";
import { defineRoute, withIdempotency } from "@/composition/route";
import {
  expenseFromBody,
  RecordExpenseBodySchema,
  recordedExpenseDto,
  transactionHeaders,
} from "@/modules/ledger/contracts/ledger.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: RecordExpenseBodySchema,
  before: withIdempotency,
  handler: async ({ user, params, body }) => {
    const fields = expenseFromBody(body);
    if (!fields.ok) return fields;
    const result = await getContainer().ledger.recordExpense({
      spaceId: params.spaceId!,
      userId: user!.id,
      ...fields.value,
    });
    return result.ok
      ? ok({
          status: 201,
          body: recordedExpenseDto(result.value),
          headers: transactionHeaders(result.value.expense),
        })
      : result;
  },
});
