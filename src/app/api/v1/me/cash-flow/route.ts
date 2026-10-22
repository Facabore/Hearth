import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { cashFlowDto, CashFlowQuerySchema } from "@/modules/reporting/contracts/reporting.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: CashFlowQuerySchema,
  handler: async ({ user, query }) => {
    const result = await getContainer().reporting.getCashFlow({ userId: user!.id, days: query.days });
    return result.ok ? ok({ status: 200, body: cashFlowDto(result.value) }) : result;
  },
});
