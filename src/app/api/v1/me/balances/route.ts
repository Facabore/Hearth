import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { myBalancesDto } from "@/modules/balances/contracts/balances.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** #240 (ruling P278): the signed-in person's standing in each of her shared and direct spaces. */
export const GET = defineRoute({
  auth: "required",
  handler: async ({ user }) => {
    const result = await getContainer().balances.getMyBalances(user!.id);
    return result.ok ? ok({ status: 200, body: myBalancesDto(result.value) }) : result;
  },
});
