import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  categoryGroupDto,
  UpdateCategoryGroupBodySchema,
} from "@/modules/categories/contracts/categories.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const PATCH = defineRoute({
  auth: "required",
  body: UpdateCategoryGroupBodySchema,
  handler: async ({ user, params, body }) => {
    const result = await getContainer().categories.renameCategoryGroup({
      spaceId: params.spaceId!,
      userId: user!.id,
      groupId: params.groupId!,
      name: body.name,
      icon: body.icon,
      color: body.color,
    });
    return result.ok ? ok({ status: 200, body: categoryGroupDto(result.value) }) : result;
  },
});

/** P347: deletes the group with its categories, logically (D8); 204 without a body. */
export const DELETE = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().categories.deleteCategoryGroup({
      spaceId: params.spaceId!,
      userId: user!.id,
      groupId: params.groupId!,
    });
    return result.ok ? ok({ status: 204 }) : result;
  },
});
