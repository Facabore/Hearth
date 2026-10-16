import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { balanceHistoryDto, BalanceHistoryQuerySchema } from "@/modules/balances/contracts/balances.contract";
import { optionalLocalDate } from "@/shared/http/contracts";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: BalanceHistoryQuerySchema,
  handler: async ({ user, params, query }) => {
    const from = optionalLocalDate(query.from);
    if (!from.ok) return from;
    const to = optionalLocalDate(query.to);
    if (!to.ok) return to;
    const result = await getContainer().balances.getMemberBalanceHistory({
      spaceId: params.spaceId!,
      userId: user!.id,
      memberId: params.memberId!,
      from: from.value ?? null,
      to: to.value ?? null,
    });
    return result.ok ? ok({ status: 200, body: balanceHistoryDto(result.value) }) : result;
  },
});
