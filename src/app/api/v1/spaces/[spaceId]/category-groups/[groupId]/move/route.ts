import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  anchorOf,
  categoryGroupDto,
  MoveCategoryGroupBodySchema,
} from "@/modules/categories/contracts/categories.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** Ruling P296: one place up or down, as the screen sees it: right before or right after another group. */
export const POST = defineRoute({
  auth: "required",
  body: MoveCategoryGroupBodySchema,
  handler: async ({ user, params, body }) => {
    const result = await getContainer().categories.moveCategoryGroup({
      spaceId: params.spaceId!,
      userId: user!.id,
      groupId: params.groupId!,
      anchor: anchorOf(body),
    });
    return result.ok ? ok({ status: 200, body: { items: result.value.map(categoryGroupDto) } }) : result;
  },
});
