import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  CategoryGroupBodySchema,
  categoryGroupDto,
} from "@/modules/categories/contracts/categories.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const PATCH = defineRoute({
  auth: "required",
  body: CategoryGroupBodySchema,
  handler: async ({ user, params, body }) => {
    const result = await getContainer().categories.renameCategoryGroup({
      spaceId: params.spaceId!,
      userId: user!.id,
      groupId: params.groupId!,
      name: body.name,
    });
    return result.ok ? ok({ status: 200, body: categoryGroupDto(result.value) }) : result;
  },
});
