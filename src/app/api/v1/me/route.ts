import { ok } from "@/shared/kernel";
import { defineRoute } from "@/composition/route";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user }) => ok({ status: 200, body: user }),
});
