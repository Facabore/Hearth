import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { invitationPreviewDto } from "@/modules/spaces/contracts/spaces.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** HU-E9-05, ruling P156: public; the 256-bit token is the authorization, and a preview changes nothing. */
export const GET = defineRoute({
  auth: "none",
  handler: async ({ params }) => {
    const result = await getContainer().spaces.previewInvitation({ token: params.token! });
    return result.ok ? ok({ status: 200, body: invitationPreviewDto(result.value) }) : result;
  },
});
