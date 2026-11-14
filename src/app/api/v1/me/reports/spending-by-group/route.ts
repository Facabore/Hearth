import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  personalSpendingByGroupDto,
  SpendingByGroupQuerySchema,
} from "@/modules/reporting/contracts/reporting.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: SpendingByGroupQuerySchema,
  handler: async ({ user, query }) => {
    const result = await getContainer().reporting.getPersonalSpendingByGroup({
      userId: user!.id,
      period: query.period,
      accountId: query.accountId,
    });
    return result.ok ? ok({ status: 200, body: personalSpendingByGroupDto(result.value) }) : result;
  },
});
