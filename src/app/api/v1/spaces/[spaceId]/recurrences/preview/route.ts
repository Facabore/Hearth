import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { PreviewScheduleBodySchema } from "@/modules/ledger/contracts/recurrences.contract";
import { ok, type LocalDate } from "@/shared/kernel";

export const runtime = "nodejs";

/** #77 (HU-E9-09): a schedule's dates before its recurrence is defined; a read, so no idempotency key. */
export const POST = defineRoute({
  auth: "required",
  body: PreviewScheduleBodySchema,
  handler: async ({ user, params, body }) => {
    const result = await getContainer().ledger.previewSchedule({
      spaceId: params.spaceId!,
      userId: user!.id,
      schedule: body.schedule,
      startDate: body.startDate as LocalDate,
      endDate: (body.endDate ?? null) as LocalDate | null,
      count: body.count,
    });
    return result.ok ? ok({ status: 200, body: { dates: result.value } }) : result;
  },
});
