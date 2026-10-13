import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  categoryTreeDto,
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
