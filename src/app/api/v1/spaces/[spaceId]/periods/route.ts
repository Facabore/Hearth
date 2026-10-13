import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { ListPeriodsQuerySchema } from "@/modules/spaces/contracts/spaces.contract";
import { optionalLocalDate, periodDto } from "@/shared/http/contracts";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: ListPeriodsQuerySchema,
  handler: async ({ user, params, query }) => {
    const from = optionalLocalDate(query.from);
    if (!from.ok) return from;
    const result = await getContainer().spaces.listPeriods({
      spaceId: params.spaceId!,
      userId: user!.id,
      from: from.value,
      count: query.count,
    });
    return result.ok ? ok({ status: 200, body: { items: result.value.map(periodDto) } }) : result;
  },
});
