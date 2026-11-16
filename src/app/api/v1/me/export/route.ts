import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { attachment, ExportQuerySchema } from "@/modules/portability/contracts/export.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** D28, design §3.6: the person's data, as Hearth's JSON or as a ZIP of CSV files; never cached on the way. */
export const GET = defineRoute({
  auth: "required",
  query: ExportQuerySchema,
  handler: async ({ user, query }) => {
    const result = await getContainer().portability.exportPersonData({
      user: user!,
      format: query.format,
      spaceId: query.spaceId,
    });
    if (!result.ok) return result;
    const file = result.value;
    const headers = [attachment(file.filename), ["cache-control", "no-store"] as const];
    return file.format === "json"
      ? ok({ status: 200, body: file.document, headers })
      : ok({ status: 200, body: file.archive, contentType: "application/zip", headers });
  },
});
