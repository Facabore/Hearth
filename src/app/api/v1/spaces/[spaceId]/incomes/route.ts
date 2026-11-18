import { getContainer } from "@/composition/container";
import { defineRoute, withIdempotency } from "@/composition/route";
import {
  incomeFromBody,
  RecordIncomeBodySchema,
  transactionDto,
  transactionHeaders,
} from "@/modules/ledger/contracts/ledger.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: RecordIncomeBodySchema,
  before: withIdempotency,
  handler: async ({ user, params, body }) => {
    // P342 (S3): the income in its own currency, with what the account received when it is in another one.
    const fields = incomeFromBody(body);
    if (!fields.ok) return fields;
    const result = await getContainer().ledger.recordIncome({
      spaceId: params.spaceId!,
      userId: user!.id,
      ...fields.value,
    });
    return result.ok
      ? ok({ status: 201, body: transactionDto(result.value), headers: transactionHeaders(result.value) })
      : result;
  },
});
