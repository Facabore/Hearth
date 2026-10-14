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

// Length rules live in the domain (InvalidCategoryName); the cap only bounds payload size.
const Name = z.string().max(200);
const ParentId = z.string().min(1).max(64);
export const CategoryGroupBodySchema = z.object({ name: Name });
export const CreateCategoryBodySchema = z.object({ groupId: ParentId, name: Name });
export const UpdateCategoryBodySchema = z.object({ name: Name.optional(), groupId: ParentId.optional() });

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

const CategoryPath = SpacePath.extend({ categoryId: z.string() });
const GroupPath = SpacePath.extend({ groupId: z.string() });
const managed = { "401": "Unauthenticated", "403": "InsufficientRole" };

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
    post: {
      operationId: "createCategory",
      summary: "Create a category in a group (two levels only)",
      ...securedByUser,
      requestParams: { path: SpacePath },
      requestBody: { content: jsonContent(CreateCategoryBodySchema) },
      responses: {
        "201": { description: "The new category", content: jsonContent(CategorySchema) },
        ...problems({
          ...managed,
          "404": "SpaceNotFound, CategoryGroupNotFound",
          "409": "CategoryNameTaken, CategoryDepthExceeded, CategoryGroupArchived, SpaceArchived",
          "422": "ValidationFailed, InvalidCategoryName",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/categories/{categoryId}": {
    patch: {
      operationId: "updateCategory",
      summary: "Rename a category and/or move it to another group",
      ...securedByUser,
      requestParams: { path: CategoryPath },
      requestBody: { content: jsonContent(UpdateCategoryBodySchema) },
      responses: {
        "200": { description: "The updated category", content: jsonContent(CategorySchema) },
        ...problems({
          ...managed,
          "404": "SpaceNotFound, CategoryNotFound, CategoryGroupNotFound",
          "409": "CategoryNameTaken, CategoryDepthExceeded, CategoryGroupArchived, SpaceArchived",
          "422": "ValidationFailed, InvalidCategoryName",
        }),
      },
    },
    delete: {
      operationId: "deleteCategory",
      summary: "Delete a category that no transaction references (archive it otherwise)",
      ...securedByUser,
      requestParams: { path: CategoryPath },
      responses: {
        "204": { description: "Deleted" },
        ...problems({
          ...managed,
          "404": "SpaceNotFound, CategoryNotFound",
          "409": "CategoryInUse, SpaceArchived",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/category-groups": {
    post: {
      operationId: "createCategoryGroup",
      summary: "Create a category group",
      ...securedByUser,
      requestParams: { path: SpacePath },
      requestBody: { content: jsonContent(CategoryGroupBodySchema) },
      responses: {
        "201": { description: "The new group", content: jsonContent(CategoryGroupSummarySchema) },
        ...problems({
          ...managed,
          "404": "SpaceNotFound",
          "409": "CategoryGroupNameTaken, SpaceArchived",
          "422": "ValidationFailed, InvalidCategoryName",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/category-groups/{groupId}": {
    patch: {
      operationId: "renameCategoryGroup",
      summary: "Rename a category group",
      ...securedByUser,
      requestParams: { path: GroupPath },
      requestBody: { content: jsonContent(CategoryGroupBodySchema) },
      responses: {
        "200": { description: "The renamed group", content: jsonContent(CategoryGroupSummarySchema) },
        ...problems({
          ...managed,
          "404": "SpaceNotFound, CategoryGroupNotFound",
          "409": "CategoryGroupNameTaken, SpaceArchived",
          "422": "ValidationFailed, InvalidCategoryName",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/categories/{categoryId}/archive": {
    post: {
      operationId: "archiveCategory",
      summary: "Archive a category: it stays in history but cannot be used for new transactions",
      ...securedByUser,
      requestParams: { path: CategoryPath },
      responses: {
        "200": { description: "The archived category", content: jsonContent(CategorySchema) },
        ...problems({ ...managed, "404": "SpaceNotFound, CategoryNotFound", "409": "SpaceArchived" }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/categories/{categoryId}/restore": {
    post: {
      operationId: "restoreCategory",
      summary: "Restore an archived category",
      ...securedByUser,
      requestParams: { path: CategoryPath },
      responses: {
        "200": { description: "The restored category", content: jsonContent(CategorySchema) },
        ...problems({
          ...managed,
          "404": "SpaceNotFound, CategoryNotFound",
          "409": "CategoryGroupArchived, SpaceArchived",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/category-groups/{groupId}/archive": {
    post: {
      operationId: "archiveCategoryGroup",
      summary: "Archive a group together with all its categories",
      ...securedByUser,
      requestParams: { path: GroupPath },
      responses: {
        "200": { description: "The archived group", content: jsonContent(CategoryGroupSummarySchema) },
        ...problems({ ...managed, "404": "SpaceNotFound, CategoryGroupNotFound", "409": "SpaceArchived" }),
      },
    },
  },
};
