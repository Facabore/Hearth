import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { UpcomingOccurrencesQuerySchema } from "@/modules/ledger/contracts/recurrences.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: UpcomingOccurrencesQuerySchema,
  handler: async ({ user, params, query }) => {
    const result = await getContainer().ledger.listUpcomingOccurrences({
      spaceId: params.spaceId!,
      userId: user!.id,
      recurrenceId: params.recurrenceId!,
      count: query.count,
    });
    return result.ok ? ok({ status: 200, body: { dates: result.value } }) : result;
  },
});
