import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { SignInBodySchema } from "@/modules/identity/contracts/auth.contract";
import { clientIpOf } from "@/shared/http";
import { domainError, err, ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "none",
  body: SignInBodySchema,
  handler: async ({ body, request }) => {
    const container = getContainer();
    if (!container.authThrottle.signIn(clientIpOf(request.headers), body.email)) {
      return err(domainError("TooManyRequests"));
    }
    const result = await container.identity.signIn(body);
    if (!result.ok) return result;
    return ok({
      status: 200,
      body: { user: result.value.user, token: result.value.token },
      headers: result.value.cookies.map((cookie) => ["set-cookie", cookie] as const),
    });
  },
});
