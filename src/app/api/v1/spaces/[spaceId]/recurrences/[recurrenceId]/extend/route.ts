import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  ExtendRecurrenceBodySchema,
  extensionEndDateFromBody,
  recurrenceDto,
} from "@/modules/ledger/contracts/recurrences.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: ExtendRecurrenceBodySchema,
  handler: async ({ user, params, body }) => {
    const endDate = extensionEndDateFromBody(body);
    if (!endDate.ok) return endDate;
    const result = await getContainer().ledger.extendRecurrence({
      spaceId: params.spaceId!,
      userId: user!.id,
      recurrenceId: params.recurrenceId!,
      endDate: endDate.value,
    });
    return result.ok ? ok({ status: 200, body: recurrenceDto(result.value) }) : result;
  },
});
