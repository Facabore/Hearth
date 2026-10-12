import { ok } from "@/shared/kernel";
import { defineRoute } from "@/composition/route";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "none",
  handler: async () => ok({ status: 200, body: { status: "ok" } }),
});
