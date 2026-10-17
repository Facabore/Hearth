import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  categoryDto,
  categoryTreeDto,
  CreateCategoryBodySchema,
  ListCategoriesQuerySchema,
} from "@/modules/categories/contracts/categories.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: ListCategoriesQuerySchema,
  handler: async ({ user, params, query }) => {
    const result = await getContainer().categories.listCategories({
      spaceId: params.spaceId!,
      userId: user!.id,
      includeArchived: query.archived === "true",
    });
    return result.ok ? ok({ status: 200, body: { items: result.value.map(categoryTreeDto) } }) : result;
  },
});

export const POST = defineRoute({
  auth: "required",
  body: CreateCategoryBodySchema,
  handler: async ({ user, params, body }) => {
    const result = await getContainer().categories.createCategory({
      spaceId: params.spaceId!,
      userId: user!.id,
      groupId: body.groupId,
      parentCategoryId: body.parentCategoryId,
      icon: body.icon,
      color: body.color,
      name: body.name,
    });
    return result.ok ? ok({ status: 201, body: categoryDto(result.value) }) : result;
  },
});
