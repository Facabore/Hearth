import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { ClaimReferrerBodySchema } from "@/modules/referrals/contracts/referrals.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** D27: the signed-in person names the link they signed up through; the use case decides whether it counts. */
export const POST = defineRoute({
  auth: "required",
  body: ClaimReferrerBodySchema,
  handler: async ({ user, body }) => {
    const result = await getContainer().referrals.claim({ user: user!, code: body.code });
    return result.ok ? ok({ status: 204 }) : result;
  },
});
