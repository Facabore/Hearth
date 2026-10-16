import { getContainer } from "@/composition/container";
import { defineRoute, withIdempotency } from "@/composition/route";
import {
  DefineRecurrenceBodySchema,
  recurrenceDto,
  recurrenceFromBody,
  recurrenceHeaders,
} from "@/modules/ledger/contracts/recurrences.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: DefineRecurrenceBodySchema,
  before: withIdempotency,
  handler: async ({ user, params, body }) => {
    const fields = recurrenceFromBody(body);
    if (!fields.ok) return fields;
    const result = await getContainer().ledger.defineRecurrence({
      spaceId: params.spaceId!,
      userId: user!.id,
      ...fields.value,
    });
    return result.ok
      ? ok({ status: 201, body: recurrenceDto(result.value), headers: recurrenceHeaders(result.value) })
      : result;
  },
});

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().ledger.listRecurrences({
      spaceId: params.spaceId!,
      userId: user!.id,
    });
    return result.ok
      ? ok({ status: 200, body: { items: result.value.map((view) => recurrenceDto(view)) } })
      : result;
  },
});
