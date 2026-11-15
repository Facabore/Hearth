import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { referralPreviewDto } from "@/modules/referrals/contracts/referrals.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** D27: public; the unguessable code is the authorization, and the answer is only the referrer's first name. */
export const GET = defineRoute({
  auth: "none",
  handler: async ({ params }) => {
    const result = await getContainer().referrals.preview({ code: params.code! });
    return result.ok ? ok({ status: 200, body: referralPreviewDto(result.value) }) : result;
  },
});
