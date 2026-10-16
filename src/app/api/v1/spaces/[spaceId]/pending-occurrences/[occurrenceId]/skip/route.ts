import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { occurrenceDto } from "@/modules/ledger/contracts/recurrences.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().ledger.skipOccurrence({
      spaceId: params.spaceId!,
      userId: user!.id,
      occurrenceId: params.occurrenceId!,
    });
    return result.ok
      ? ok({ status: 200, body: occurrenceDto(result.value.occurrence, result.value.recurrence) })
      : result;
  },
});
