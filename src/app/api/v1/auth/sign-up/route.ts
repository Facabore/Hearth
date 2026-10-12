import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { SignUpBodySchema } from "@/modules/identity/contracts/auth.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "none",
  body: SignUpBodySchema,
  handler: async ({ body }) => {
    const result = await getContainer().identity.signUp(body);
    if (!result.ok) return result;
    return ok({
      status: 201,
      body: { user: result.value.user },
      headers: result.value.cookies.map((cookie) => ["set-cookie", cookie] as const),
    });
  },
});
