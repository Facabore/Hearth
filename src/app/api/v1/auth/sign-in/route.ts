import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { SignInBodySchema } from "@/modules/identity/contracts/auth.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "none",
  body: SignInBodySchema,
  handler: async ({ body }) => {
    const result = await getContainer().identity.signIn(body);
    if (!result.ok) return result;
    return ok({
      status: 200,
      body: { user: result.value.user, token: result.value.token },
      headers: result.value.cookies.map((cookie) => ["set-cookie", cookie] as const),
    });
  },
});
