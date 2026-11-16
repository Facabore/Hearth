import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { undoneImportDto } from "@/modules/portability/contracts/import.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** D28, design §3.2: undoes a confirmed import. */
export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().portability.undoImport({
      spaceId: params.spaceId!,
      userId: user!.id,
      importId: params.importId!,
    });
    return result.ok ? ok({ status: 200, body: undoneImportDto(result.value) }) : result;
  },
});
