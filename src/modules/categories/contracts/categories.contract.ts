import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { jsonContent, problems, securedByUser } from "@/shared/http/contracts";
import {
  CATEGORY_COLORS,
  type CategoryGroup,
  type CategoryGroupView,
  type CategoryView,
} from "../application";

/** HU-E3-05: a symbol of the fixed set or exactly one emoji, judged by the domain (InvalidCategoryIcon). */
const IconSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("SYMBOL"), name: z.string().max(64) }),
  z.object({ kind: z.literal("EMOJI"), value: z.string().max(64) }),
]);
/** HU-E3-05, D22: a palette key, never a hex value; anything else is ValidationFailed. */
const ColorSchema = z.enum(CATEGORY_COLORS);

export const CategorySchema = z.object({
  id: z.string(),
  groupId: z.string(),
  /** HU-E3-04: the category this subcategory refines; null for a category directly in its group. */
  parentCategoryId: z.string().nullable(),
  name: z.string(),
  /** Stable catalog key of seeded categories; null for user-created ones. */
  key: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  /** HU-E3-05: the icon and color it shows; a subcategory shows its parent's. */
  icon: IconSchema,
  color: ColorSchema,
});
export const CategoryGroupSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** HU-E3-05: stable catalog key of seeded groups (`food`); null for groups users create. Read-only: no body takes it. */
  key: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  /** HU-E3-05: the group's icon and color. */
  icon: IconSchema,
  color: ColorSchema,
});
export const CategoryGroupSchema = CategoryGroupSummarySchema.extend({
  /** HU-E3-04: the group's categories, each with its subcategories. */
  categories: z.array(CategorySchema.extend({ subcategories: z.array(CategorySchema) })),
});

export const ListCategoriesQuerySchema = z.object({ archived: z.enum(["true", "false"]).optional() });
export const ListCategoriesResponseSchema = z.object({ items: z.array(CategoryGroupSchema) });

// Length rules live in the domain (InvalidCategoryName); the cap only bounds payload size.
const Name = z.string().max(200);
const ParentId = z.string().min(1).max(64);
export const CategoryGroupBodySchema = z.object({ name: Name });
/** HU-E3-04: a category of `groupId`, or a subcategory of `parentCategoryId`; exactly one. */
export const CreateCategoryBodySchema = z
  .object({ groupId: ParentId.optional(), parentCategoryId: ParentId.optional(), name: Name })
  .refine((body) => (body.groupId === undefined) !== (body.parentCategoryId === undefined), {
    error: "Send exactly one of groupId and parentCategoryId",
    path: ["groupId"],
  });
/** HU-E3-04: `parentCategoryId` makes it a subcategory (in its parent's group); null makes it a category again. */
export const UpdateCategoryBodySchema = z
  .object({
    name: Name.optional(),
    groupId: ParentId.optional(),
    parentCategoryId: ParentId.nullable().optional(),
  })
  .refine((body) => body.groupId === undefined || typeof body.parentCategoryId !== "string", {
    error: "A subcategory takes its parent's group",
    path: ["groupId"],
  });

const isoOrNull = (date: Date | null) => date?.toISOString() ?? null;

export const categoryDto = (c: CategoryView): z.infer<typeof CategorySchema> => ({
  id: c.id,
  groupId: c.groupId,
  parentCategoryId: c.parentCategoryId,
  name: c.name,
  key: c.key,
  archivedAt: isoOrNull(c.archivedAt),
  icon: c.shown.icon,
  color: c.shown.color,
});

export const categoryGroupDto = (g: CategoryGroup): z.infer<typeof CategoryGroupSummarySchema> => ({
  id: g.id,
  name: g.name,
  key: g.key,
  archivedAt: isoOrNull(g.archivedAt),
  icon: g.style.icon,
  color: g.style.color,
});

export const categoryTreeDto = (g: CategoryGroupView): z.infer<typeof CategoryGroupSchema> => ({
  ...categoryGroupDto(g),
  categories: g.categories.map((c) => ({
    ...categoryDto(c),
    subcategories: c.subcategories.map(categoryDto),
  })),
});

const SpacePath = z.object({ spaceId: z.string() });

const CategoryPath = SpacePath.extend({ categoryId: z.string() });
const GroupPath = SpacePath.extend({ groupId: z.string() });
const managed = { "401": "Unauthenticated", "403": "InsufficientRole" };

export const categoriesPaths: ZodOpenApiPathsObject = {
  "/api/v1/spaces/{spaceId}/categories": {
    get: {
      operationId: "listCategories",
      summary:
        "Category tree of a space, with nested subcategories; archived groups, categories and subcategories only with archived=true",
      ...securedByUser,
      requestParams: { path: SpacePath, query: ListCategoriesQuerySchema },
      responses: {
        "200": {
          description: "Groups with their categories and each category's subcategories, sorted by name",
          content: jsonContent(ListCategoriesResponseSchema),
        },
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound", "422": "ValidationFailed" }),
      },
    },
    post: {
      operationId: "createCategory",
      summary: "Create a category in a group, or a subcategory under a category",
      ...securedByUser,
      requestParams: { path: SpacePath },
      requestBody: { content: jsonContent(CreateCategoryBodySchema) },
      responses: {
        "201": { description: "The new category", content: jsonContent(CategorySchema) },
        ...problems({
          ...managed,
          "404": "SpaceNotFound, CategoryGroupNotFound, CategoryNotFound",
          "409":
            "CategoryNameTaken, CategoryDepthExceeded, CategoryGroupArchived, SpaceArchived, ParentCategoryArchived",
          "422": "ValidationFailed, InvalidCategoryName",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/categories/{categoryId}": {
    patch: {
      operationId: "updateCategory",
      summary: "Rename a category, move it to another group, or move it under or out of a parent",
      ...securedByUser,
      requestParams: { path: CategoryPath },
      requestBody: { content: jsonContent(UpdateCategoryBodySchema) },
      responses: {
        "200": { description: "The updated category", content: jsonContent(CategorySchema) },
        ...problems({
          ...managed,
          "404": "SpaceNotFound, CategoryNotFound, CategoryGroupNotFound",
          "409":
            "CategoryNameTaken, CategoryDepthExceeded, CategoryGroupArchived, SpaceArchived, ParentCategoryArchived",
          "422": "ValidationFailed, InvalidCategoryName",
        }),
      },
    },
    delete: {
      operationId: "deleteCategory",
      summary:
        "Delete a category that no transaction references and that has no subcategories (archive it otherwise)",
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
      summary:
        "Archive a category and its subcategories: they stay in history but cannot be used for new transactions",
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
          "409": "CategoryGroupArchived, SpaceArchived, ParentCategoryArchived",
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
