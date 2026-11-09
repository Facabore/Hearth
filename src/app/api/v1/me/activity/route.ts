import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { activityItemDto, MyActivityQuerySchema } from "@/modules/ledger/contracts/ledger.contract";
import { localDate, ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** Ruling P306 (#268): the personal Inicio's feed of the caller's shared and direct spaces. */
export const GET = defineRoute({
  auth: "required",
  query: MyActivityQuerySchema,
  handler: async ({ user, query }) => {
    const from = localDate(query.from);
    if (!from.ok) return from;
    const to = query.to === undefined ? undefined : localDate(query.to);
    if (to && !to.ok) return to;
    const result = await getContainer().ledger.listMyActivity({
      userId: user!.id,
      from: from.value,
      ...(to ? { to: to.value } : {}),
      limit: query.limit,
    });
    return result.ok ? ok({ status: 200, body: { items: result.value.map(activityItemDto) } }) : result;
  },
});
