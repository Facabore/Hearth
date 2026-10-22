import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  editChangesFromBody,
  EditTransactionBodySchema,
  transactionDto,
} from "@/modules/ledger/contracts/ledger.contract";
import { etagOf, ifMatchVersion } from "@/shared/http";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().ledger.getTransaction({
      spaceId: params.spaceId!,
      userId: user!.id,
      transactionId: params.transactionId!,
    });
    return result.ok
      ? ok({
          status: 200,
          body: transactionDto(result.value),
          headers: [["etag", etagOf(result.value.version)] as const],
        })
      : result;
  },
});

export const PATCH = defineRoute({
  auth: "required",
  body: EditTransactionBodySchema,
  handler: async ({ request, user, params, body }) => {
    // Spec section 7: If-Match is checked when present; a stale version is 412.
    const expectedVersion = ifMatchVersion(request);
    if (!expectedVersion.ok) return expectedVersion;
    const changes = editChangesFromBody(body);
    if (!changes.ok) return changes;
    const result = await getContainer().ledger.editTransaction({
      spaceId: params.spaceId!,
      userId: user!.id,
      transactionId: params.transactionId!,
      expectedVersion: expectedVersion.value,
      changes: changes.value,
    });
    return result.ok
      ? ok({
          status: 200,
          body: transactionDto(result.value),
          headers: [["etag", etagOf(result.value.version)] as const],
        })
      : result;
  },
});

export const DELETE = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().ledger.deleteTransaction({
      spaceId: params.spaceId!,
      userId: user!.id,
      transactionId: params.transactionId!,
    });
    return result.ok ? ok({ status: 204 }) : result;
  },
});
