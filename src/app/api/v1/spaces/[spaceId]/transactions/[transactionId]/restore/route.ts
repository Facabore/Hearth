import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { transactionDto } from "@/modules/ledger/contracts/ledger.contract";
import { etagOf } from "@/shared/http";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** Ruling P185: undo a deletion. No body and no Idempotency-Key: restoring twice changes nothing. */
export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().ledger.restoreTransaction({
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
