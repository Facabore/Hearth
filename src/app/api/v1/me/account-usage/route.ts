import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { accountUsageDto } from "@/modules/ledger/contracts/ledger.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** Ruling P337 (#334): what "Desde" orders the caller's accounts by and preselects for a category. */
export const GET = defineRoute({
  auth: "required",
  handler: async ({ user }) => {
    const result = await getContainer().ledger.getAccountUsage({ userId: user!.id });
    return result.ok ? ok({ status: 200, body: accountUsageDto(result.value) }) : result;
  },
});
