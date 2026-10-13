import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { CreateSpaceBodySchema } from "@/modules/spaces/contracts/spaces.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user }) => {
    const result = await getContainer().spaces.listMySpaces(user!.id);
    return result.ok ? ok({ status: 200, body: { items: result.value } }) : result;
  },
});

export const POST = defineRoute({
  auth: "required",
  body: CreateSpaceBodySchema,
  handler: async ({ user, body }) => {
    const creator = { userId: user!.id, userName: user!.name, locale: user!.locale };
    const result = await getContainer().spaces.createSpace(
      body.kind === "SHARED"
        ? { ...creator, kind: "SHARED", name: body.name, currency: body.currency }
        : { ...creator, kind: "PERSONAL" },
    );
    return result.ok ? ok({ status: 201, body: result.value }) : result;
  },
});
