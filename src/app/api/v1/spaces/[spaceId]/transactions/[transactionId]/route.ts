import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { transactionDto } from "@/modules/ledger/contracts/ledger.contract";
import { etagOf } from "@/shared/http";
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
