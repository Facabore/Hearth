import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { auditEntryDto } from "@/modules/ledger/contracts/ledger.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().ledger.listAudit({
      spaceId: params.spaceId!,
      userId: user!.id,
      transactionId: params.transactionId!,
    });
    return result.ok ? ok({ status: 200, body: { items: result.value.map(auditEntryDto) } }) : result;
  },
});
