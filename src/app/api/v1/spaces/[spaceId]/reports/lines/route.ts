import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { lineDashboardDto, ReportQuerySchema } from "@/modules/reporting/contracts/reporting.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: ReportQuerySchema,
  handler: async ({ user, params, query }) => {
    const result = await getContainer().reporting.getLineDashboard({
      spaceId: params.spaceId!,
      userId: user!.id,
      period: query.period,
    });
    return result.ok ? ok({ status: 200, body: lineDashboardDto(result.value) }) : result;
  },
});
