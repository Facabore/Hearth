import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { ReportQuerySchema, unifiedViewDto } from "@/modules/reporting/contracts/reporting.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: ReportQuerySchema,
  handler: async ({ user, query }) => {
    const result = await getContainer().reporting.getUnifiedPersonalView({
      userId: user!.id,
      period: query.period,
    });
    return result.ok ? ok({ status: 200, body: unifiedViewDto(result.value) }) : result;
  },
});
