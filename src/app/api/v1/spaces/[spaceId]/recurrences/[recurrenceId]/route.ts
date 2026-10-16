import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  recurrenceDto,
  recurrenceEditFromBody,
  UpdateRecurrenceBodySchema,
} from "@/modules/ledger/contracts/recurrences.contract";
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

export const PATCH = defineRoute({
  auth: "required",
  body: UpdateRecurrenceBodySchema,
  handler: async ({ user, params, body }) => {
    const changes = recurrenceEditFromBody(body);
    if (!changes.ok) return changes;
    const result = await getContainer().ledger.updateRecurrence({
      spaceId: params.spaceId!,
      userId: user!.id,
      recurrenceId: params.recurrenceId!,
      changes: changes.value,
    });
    return result.ok ? ok({ status: 200, body: recurrenceDto(result.value) }) : result;
  },
});
