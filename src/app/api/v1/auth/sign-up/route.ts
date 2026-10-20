import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { SignUpBodySchema } from "@/modules/identity/contracts/auth.contract";
import { clientIpOf } from "@/shared/http";
import { domainError, err, ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** Ruling P143: public, so the sign-up screen can explain a closed installation and the sign-in screen can hide its link. */
export const GET = defineRoute({
  auth: "none",
  handler: async () => ok({ status: 200, body: { signUp: getContainer().identity.signUpMode } }),
});

export const POST = defineRoute({
  auth: "none",
  body: SignUpBodySchema,
  handler: async ({ body, request }) => {
    const container = getContainer();
    if (!container.authThrottle.signUp(clientIpOf(request.headers)))
      return err(domainError("TooManyRequests"));
    const result = await container.identity.signUp(body);
    if (!result.ok) return result;
    return ok({
      status: 201,
      body: { user: result.value.user },
      headers: result.value.cookies.map((cookie) => ["set-cookie", cookie] as const),
    });
  },
});
