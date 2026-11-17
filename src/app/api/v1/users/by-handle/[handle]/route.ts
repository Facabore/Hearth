import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** Ruling P339: someone by their exact @usuario; the answer is their handle and name only. */
export const GET = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().identity.findUserByHandle({
      userId: user!.id,
      handle: params.handle!,
    });
    return result.ok
      ? ok({ status: 200, body: { handle: result.value.handle, displayName: result.value.displayName } })
      : result;
  },
});
