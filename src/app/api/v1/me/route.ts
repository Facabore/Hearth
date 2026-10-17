import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { meDto, UpdateMeBodySchema } from "@/modules/identity/contracts/me.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user }) => {
    // HU-E1-15: the user with their formatting preferences, as they apply.
    const profile = await getContainer().identity.getProfile({ user: user! });
    return profile.ok ? ok({ status: 200, body: meDto(profile.value) }) : profile;
  },
});

export const PATCH = defineRoute({
  auth: "required",
  body: UpdateMeBodySchema,
  handler: async ({ user, body }) => {
    const result = await getContainer().identity.updateProfile({ user: user!, timezone: body.timezone });
    return result.ok ? ok({ status: 200, body: result.value }) : result;
  },
});
