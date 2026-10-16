import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { occurrenceDto } from "@/modules/ledger/contracts/recurrences.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().ledger.listPendingOccurrences({
      spaceId: params.spaceId!,
      userId: user!.id,
    });
    return result.ok
      ? ok({
          status: 200,
          body: { items: result.value.map((view) => occurrenceDto(view.occurrence, view.recurrence)) },
        })
      : result;
  },
});
