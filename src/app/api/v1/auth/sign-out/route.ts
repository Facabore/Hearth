import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ request }) => {
    const result = await getContainer().identity.signOut({
      cookie: request.headers.get("cookie") ?? undefined,
      authorization: request.headers.get("authorization") ?? undefined,
    });
    if (!result.ok) return result;
    return ok({
      status: 204,
      headers: result.value.cookies.map((cookie) => ["set-cookie", cookie] as const),
    });
  },
});
