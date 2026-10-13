import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { categoryDto, UpdateCategoryBodySchema } from "@/modules/categories/contracts/categories.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const PATCH = defineRoute({
  auth: "required",
  body: UpdateCategoryBodySchema,
  handler: async ({ user, params, body }) => {
    const result = await getContainer().categories.updateCategory({
      spaceId: params.spaceId!,
      userId: user!.id,
      categoryId: params.categoryId!,
      name: body.name,
      groupId: body.groupId,
    });
    return result.ok ? ok({ status: 200, body: categoryDto(result.value) }) : result;
  },
});
