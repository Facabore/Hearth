import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { AdjustImportBodySchema, importPreviewDto } from "@/modules/portability/contracts/import.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** D28, design §3.2: a draft's mappings, time zone and included duplicates. */
export const PATCH = defineRoute({
  auth: "required",
  body: AdjustImportBodySchema,
  handler: async ({ user, params, body }) => {
    const result = await getContainer().portability.adjustImport({
      spaceId: params.spaceId!,
      userId: user!.id,
      importId: params.importId!,
      changes: body,
    });
    return result.ok ? ok({ status: 200, body: importPreviewDto(result.value) }) : result;
  },
});
