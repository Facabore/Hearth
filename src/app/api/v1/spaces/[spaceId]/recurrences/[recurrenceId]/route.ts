import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { recurrenceDto } from "@/modules/ledger/contracts/recurrences.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().ledger.getRecurrence({
      spaceId: params.spaceId!,
      userId: user!.id,
      recurrenceId: params.recurrenceId!,
    });
    return result.ok ? ok({ status: 200, body: recurrenceDto(result.value) }) : result;
  },
});
