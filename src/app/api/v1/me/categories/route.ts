import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  ListCategoriesQuerySchema,
  myCategoriesDto,
} from "@/modules/categories/contracts/categories.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** #338: the category tree of each of the signed-in person's active spaces, in one read. */
export const GET = defineRoute({
  auth: "required",
  query: ListCategoriesQuerySchema,
  handler: async ({ user, query }) => {
    const result = await getContainer().categories.listMyCategories({
      userId: user!.id,
      includeArchived: query.archived === "true",
    });
    return result.ok ? ok({ status: 200, body: myCategoriesDto(result.value) }) : result;
  },
});
