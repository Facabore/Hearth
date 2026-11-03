import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { VerifyEmailBodySchema } from "@/modules/identity/contracts/auth.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** Issue #86: public, since the link may open in a browser that is not signed in; the token is the proof. */
export const POST = defineRoute({
  auth: "none",
  body: VerifyEmailBodySchema,
  handler: async ({ body }) => {
    const result = await getContainer().identity.verifyEmail({ token: body.token });
    return result.ok ? ok({ status: 204 }) : result;
  },
});
