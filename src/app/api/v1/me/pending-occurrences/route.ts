import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { occurrenceDto } from "@/modules/ledger/contracts/recurrences.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** #338: the signed-in person's pending occurrences in every one of her current spaces, each with its space. */
export const GET = defineRoute({
  auth: "required",
  handler: async ({ user }) => {
    const result = await getContainer().ledger.listMyPendingOccurrences(user!.id);
    return result.ok
      ? ok({
          status: 200,
          body: {
            items: result.value.map((view) => ({
              ...occurrenceDto(view.occurrence, view.recurrence),
              spaceId: view.spaceId,
            })),
          },
        })
      : result;
  },
});
