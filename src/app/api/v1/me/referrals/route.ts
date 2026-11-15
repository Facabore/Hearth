import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { myReferralsDto } from "@/modules/referrals/contracts/referrals.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** D27: the person's own link, points and referrals; the code is created on the first read. */
export const GET = defineRoute({
  auth: "required",
  handler: async ({ user }) => {
    const result = await getContainer().referrals.getMine({ user: user! });
    return result.ok ? ok({ status: 200, body: myReferralsDto(result.value) }) : result;
  },
});
