import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { UpdateMeBodySchema } from "@/modules/identity/contracts/me.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user }) => ok({ status: 200, body: user }),
});

export const PATCH = defineRoute({
  auth: "required",
  body: UpdateMeBodySchema,
  handler: async ({ user, body }) => {
    const result = await getContainer().identity.updateProfile({ user: user!, timezone: body.timezone });
    return result.ok ? ok({ status: 200, body: result.value }) : result;
  },
});
