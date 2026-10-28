import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  conversionFromBody,
  ConvertTransactionBodySchema,
  transactionDto,
  transactionHeaders,
} from "@/modules/ledger/contracts/ledger.contract";
import { ifMatchVersion } from "@/shared/http";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/**
 * Issue #195: no Idempotency-Key. A repeated conversion finds the original deleted (TransactionNotFound), so a retry
 * never records the new movement twice.
 */
export const POST = defineRoute({
  auth: "required",
  body: ConvertTransactionBodySchema,
  handler: async ({ request, user, params, body }) => {
    // Spec section 7: If-Match is checked when present; a stale version is 412.
    const expectedVersion = ifMatchVersion(request);
    if (!expectedVersion.ok) return expectedVersion;
    const to = conversionFromBody(body);
    if (!to.ok) return to;
    const result = await getContainer().ledger.convertTransaction({
      spaceId: params.spaceId!,
      userId: user!.id,
      transactionId: params.transactionId!,
      expectedVersion: expectedVersion.value,
      to: to.value,
    });
    return result.ok
      ? ok({ status: 201, body: transactionDto(result.value), headers: transactionHeaders(result.value) })
      : result;
  },
});
