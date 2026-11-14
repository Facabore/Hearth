import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  SpendingByGroupQuerySchema,
  spendingByGroupDto,
} from "@/modules/reporting/contracts/reporting.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: SpendingByGroupQuerySchema,
  handler: async ({ user, params, query }) => {
    const result = await getContainer().reporting.getSpendingByGroup({
      spaceId: params.spaceId!,
      userId: user!.id,
      period: query.period,
      accountId: query.accountId,
    });
    return result.ok ? ok({ status: 200, body: spendingByGroupDto(result.value) }) : result;
  },
});
