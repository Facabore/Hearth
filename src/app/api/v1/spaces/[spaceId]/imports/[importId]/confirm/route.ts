import { getContainer } from "@/composition/container";
import { defineRoute, withIdempotency } from "@/composition/route";
import { importResultDto } from "@/modules/portability/contracts/import.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** D28, design §3.2: imports a draft into the ledger in one transaction; a retry with the same key replays it. */
export const POST = defineRoute({
  auth: "required",
  before: withIdempotency,
  handler: async ({ user, params }) => {
    const result = await getContainer().portability.confirmImport({
      spaceId: params.spaceId!,
      userId: user!.id,
      importId: params.importId!,
    });
    return result.ok ? ok({ status: 200, body: importResultDto(result.value) }) : result;
  },
});
