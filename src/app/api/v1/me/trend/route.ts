import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { personalTrendDto, TrendQuerySchema } from "@/modules/reporting/contracts/reporting.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: TrendQuerySchema,
  handler: async ({ user, query }) => {
    const result = await getContainer().reporting.getPersonalTrend({
      userId: user!.id,
      endPeriod: query.endPeriod,
      periods: query.periods,
    });
    return result.ok ? ok({ status: 200, body: personalTrendDto(result.value) }) : result;
  },
});
