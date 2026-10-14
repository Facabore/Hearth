import { getContainer } from "@/composition/container";
import { defineRoute, withIdempotency } from "@/composition/route";
import {
  DirectSplitBodySchema,
  directSplitDto,
  directSplitFromBody,
  transactionHeaders,
} from "@/modules/ledger/contracts/ledger.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: DirectSplitBodySchema,
  before: withIdempotency,
  handler: async ({ user, body }) => {
    const fields = directSplitFromBody(body);
    if (!fields.ok) return fields;
    const result = await getContainer().spaces.splitWithPerson({
      userId: user!.id,
      userName: user!.name,
      locale: user!.locale,
      ...fields.value,
    });
    return result.ok
      ? ok({
          status: 201,
          body: directSplitDto(result.value),
          headers: transactionHeaders(result.value.recorded.expense),
        })
      : result;
  },
});
