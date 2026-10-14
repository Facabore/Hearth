import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { spaceBalancesDto } from "@/modules/balances/contracts/balances.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().balances.getSpaceBalances({
      spaceId: params.spaceId!,
      userId: user!.id,
    });
    return result.ok ? ok({ status: 200, body: spaceBalancesDto(result.value) }) : result;
  },
});
