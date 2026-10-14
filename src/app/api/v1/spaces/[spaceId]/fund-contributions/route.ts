import { getContainer } from "@/composition/container";
import { defineRoute, withIdempotency } from "@/composition/route";
import {
  fundContributionFromBody,
  RecordFundContributionBodySchema,
  transactionDto,
  transactionHeaders,
} from "@/modules/ledger/contracts/ledger.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: RecordFundContributionBodySchema,
  before: withIdempotency,
  handler: async ({ user, params, body }) => {
    const fields = fundContributionFromBody(body);
    if (!fields.ok) return fields;
    const result = await getContainer().ledger.recordFundContribution({
      spaceId: params.spaceId!,
      userId: user!.id,
      ...fields.value,
    });
    return result.ok
      ? ok({ status: 201, body: transactionDto(result.value), headers: transactionHeaders(result.value) })
      : result;
  },
});
