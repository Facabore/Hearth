import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { lineTrendDto, TrendQuerySchema } from "@/modules/reporting/contracts/reporting.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: TrendQuerySchema,
  handler: async ({ user, params, query }) => {
    const result = await getContainer().reporting.getLineTrend({
      spaceId: params.spaceId!,
      userId: user!.id,
      endPeriod: query.endPeriod,
      periods: query.periods,
    });
    return result.ok ? ok({ status: 200, body: lineTrendDto(result.value) }) : result;
  },
});
