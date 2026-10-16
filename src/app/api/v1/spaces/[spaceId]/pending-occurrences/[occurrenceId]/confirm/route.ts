import { getContainer } from "@/composition/container";
import { defineRoute, withIdempotency } from "@/composition/route";
import { transactionHeaders } from "@/modules/ledger/contracts/ledger.contract";
import {
  ConfirmOccurrenceBodySchema,
  confirmationFromBody,
  recordedOccurrenceDto,
} from "@/modules/ledger/contracts/recurrences.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: ConfirmOccurrenceBodySchema,
  before: withIdempotency,
  handler: async ({ user, params, body }) => {
    const confirmation = confirmationFromBody(body);
    if (!confirmation.ok) return confirmation;
    const result = await getContainer().ledger.confirmOccurrence({
      spaceId: params.spaceId!,
      userId: user!.id,
      occurrenceId: params.occurrenceId!,
      ...confirmation.value,
    });
    return result.ok
      ? ok({
          status: 201,
          body: recordedOccurrenceDto(result.value),
          headers: transactionHeaders(result.value.transaction),
        })
      : result;
  },
});
