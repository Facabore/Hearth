import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { claimPreviewDto } from "@/modules/spaces/contracts/spaces.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** HU-E9-05, ruling P156: public like the invitation preview; the 256-bit token is the authorization. */
export const GET = defineRoute({
  auth: "none",
  handler: async ({ params }) => {
    const result = await getContainer().spaces.previewClaim({ token: params.token! });
    return result.ok ? ok({ status: 200, body: claimPreviewDto(result.value) }) : result;
  },
});
