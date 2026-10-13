import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { EditTransactionBodySchema, transactionDto } from "@/modules/ledger/contracts/ledger.contract";
import { etagOf, ifMatchVersion } from "@/shared/http";
import { moneyFromDto, optionalLocalDate } from "@/shared/http/contracts";
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
    const amount = body.amount === undefined ? ok(undefined) : moneyFromDto(body.amount);
    if (!amount.ok) return amount;
    const date = optionalLocalDate(body.date);
    if (!date.ok) return date;
    const result = await getContainer().ledger.editTransaction({
      spaceId: params.spaceId!,
      userId: user!.id,
      transactionId: params.transactionId!,
      expectedVersion: expectedVersion.value,
      changes: {
        description: body.description,
        date: date.value,
        categoryId: body.categoryId,
        amount: amount.value,
      },
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
