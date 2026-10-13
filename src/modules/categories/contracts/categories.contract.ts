import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { jsonContent, problems, securedByUser } from "@/shared/http/contracts";
import type { Category, CategoryGroup, CategoryGroupView } from "../application";

export const CategorySchema = z.object({
  id: z.string(),
  groupId: z.string(),
  name: z.string(),
  /** Stable catalog key of seeded categories; null for user-created ones. */
  key: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
});
export const CategoryGroupSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  archivedAt: z.iso.datetime().nullable(),
});
export const CategoryGroupSchema = CategoryGroupSummarySchema.extend({ categories: z.array(CategorySchema) });

export const ListCategoriesQuerySchema = z.object({ archived: z.enum(["true", "false"]).optional() });
export const ListCategoriesResponseSchema = z.object({ items: z.array(CategoryGroupSchema) });

const isoOrNull = (date: Date | null) => date?.toISOString() ?? null;

export const categoryDto = (c: Category): z.infer<typeof CategorySchema> => ({
  id: c.id,
  groupId: c.groupId,
  name: c.name,
  key: c.key,
  archivedAt: isoOrNull(c.archivedAt),
});

export const categoryGroupDto = (g: CategoryGroup): z.infer<typeof CategoryGroupSummarySchema> => ({
  id: g.id,
  name: g.name,
  archivedAt: isoOrNull(g.archivedAt),
});

export const categoryTreeDto = (g: CategoryGroupView): z.infer<typeof CategoryGroupSchema> => ({
  ...categoryGroupDto(g),
  categories: g.categories.map(categoryDto),
});

const SpacePath = z.object({ spaceId: z.string() });

export const categoriesPaths: ZodOpenApiPathsObject = {
  "/api/v1/spaces/{spaceId}/categories": {
    get: {
      operationId: "listCategories",
      summary: "Category tree of a space; archived groups and categories only with archived=true",
      ...securedByUser,
      requestParams: { path: SpacePath, query: ListCategoriesQuerySchema },
      responses: {
        "200": {
          description: "Groups with their categories, sorted by name",
          content: jsonContent(ListCategoriesResponseSchema),
        },
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound", "422": "ValidationFailed" }),
      },
    },
  },
};
