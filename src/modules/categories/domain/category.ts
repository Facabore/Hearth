import { domainError, err, ok, type Id, type Result } from "@/shared/kernel";
import {
  CUSTOM_GROUP_STYLE,
  changesStyle,
  restyled,
  type CategoryStyle,
  type StyleChange,
} from "./category-style";

export type CategoryGroupId = Id<"CategoryGroup">;
export type CategoryId = Id<"Category">;

export interface CategoryGroup {
  readonly id: CategoryGroupId;
  readonly spaceId: string;
  readonly name: string;
  /** HU-E3-05: the immutable catalog key of a seeded group (spec D11, like `Category.key`); null for groups users create. */
  readonly key: string | null;
  /** HU-E3-05: the group's icon and color. */
  readonly style: CategoryStyle;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
}

export interface Category {
  readonly id: CategoryId;
  readonly spaceId: string;
  readonly groupId: CategoryGroupId;
  /** HU-E3-04: the category this subcategory refines; null for a category directly in its group. */
  readonly parentCategoryId: CategoryId | null;
  readonly name: string;
  /** Stable catalog key of seeded categories (spec D11); null for categories users create. */
  readonly key: string | null;
  /** HU-E3-05: its own icon and color; null for a subcategory, which shows its parent's (`shownStyle`). */
  readonly style: CategoryStyle | null;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
}

const MAX_NAME = 60;

const nameOf = (raw: string): Result<string> => {
  const name = raw.trim();
  return name.length >= 1 && name.length <= MAX_NAME
    ? ok(name)
    : err(domainError("InvalidCategoryName", { length: name.length }));
};

/** HU-E3-02: names are unique per parent ignoring case; archived rows keep their names taken. */
const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** HU-E3-02, HU-E3-04: siblings share the group and the parent; their names are unique ignoring case. */
const nameTakenIn = (
  categories: readonly Category[],
  siblings: { readonly groupId: string; readonly parentCategoryId: string | null },
  name: string,
  exceptId?: string,
) =>
  categories.some(
    (c) =>
      c.groupId === siblings.groupId &&
      c.parentCategoryId === siblings.parentCategoryId &&
      c.id !== exceptId &&
      sameName(c.name, name),
  );

const hasSubcategories = (categories: readonly Category[], categoryId: string): boolean =>
  categories.some((c) => c.parentCategoryId === categoryId);

/** HU-E3-04, ruling P46: a parent is a live category directly in its group; a subcategory is never one. */
const usableParent = (parent: Category): Result<Category> => {
  if (parent.parentCategoryId !== null) return err(domainError("CategoryDepthExceeded"));
  return parent.archivedAt === null ? ok(parent) : err(domainError("ParentCategoryArchived"));
};

/** HU-E3-02, HU-E3-05: a group takes `style` over the custom default (`tag`, `GRAPHITE`) and has no catalog key. */
export const newGroup = (input: {
  id: CategoryGroupId;
  spaceId: string;
  name: string;
  now: Date;
  groups: readonly CategoryGroup[];
  style?: StyleChange;
}): Result<CategoryGroup> => {
  const name = nameOf(input.name);
  if (!name.ok) return name;
  if (input.groups.some((g) => sameName(g.name, name.value)))
    return err(domainError("CategoryGroupNameTaken"));
  return ok({
    id: input.id,
    spaceId: input.spaceId,
    name: name.value,
    key: null,
    style: restyled(CUSTOM_GROUP_STYLE, input.style ?? {}),
    archivedAt: null,
    createdAt: input.now,
  });
};

/** HU-E3-05: a new icon and/or color for a group; its categories keep theirs (each copied its own at creation). */
export const restyleGroup = (group: CategoryGroup, change: StyleChange): CategoryGroup => ({
  ...group,
  style: restyled(group.style, change),
});

export const renameGroup = (
  group: CategoryGroup,
  rawName: string,
  groups: readonly CategoryGroup[],
): Result<CategoryGroup> => {
  const name = nameOf(rawName);
  if (!name.ok) return name;
  if (groups.some((g) => g.id !== group.id && sameName(g.name, name.value))) {
    return err(domainError("CategoryGroupNameTaken"));
  }
  return ok({ ...group, name: name.value });
};

/** HU-E3-05, ruling P58: a category's own style, `change` over `base`; a subcategory has none and refuses one. */
const ownStyle = (
  parentCategoryId: string | null,
  base: CategoryStyle,
  change: StyleChange,
): Result<CategoryStyle | null> => {
  if (parentCategoryId === null) return ok(restyled(base, change));
  if (!changesStyle(change)) return ok(null);
  // Issue 121: the refused parts are public (`errors[].path`), so a client can point at the field.
  const errors = (["icon", "color"] as const)
    .filter((part) => change[part] !== undefined)
    .map((path) => ({ path, message: "A subcategory shows its parent's style and has none of its own" }));
  return err(domainError("ValidationFailed", { errors }));
};

/**
 * HU-E3-05, ruling P57: the style a category shows: its own, or a subcategory's parent's, derived on every read so it
 * follows the parent. A live subcategory's parent is never deleted (HU-E3-04), so the fallback is never reached.
 */
export const shownStyle = (category: Category, categories: readonly Category[]): CategoryStyle =>
  category.style ?? categories.find((c) => c.id === category.parentCategoryId)?.style ?? CUSTOM_GROUP_STYLE;

/**
 * HU-E3-02, HU-E3-04, HU-E3-05: a category of `group`, or, with `parent`, a subcategory of it. `group` must be the
 * parent's group: the use case derives it from the parent, and this function does not check the pair. A category
 * starts from a copy of its group's style with `style` over it; a subcategory has none.
 */
export const newCategory = (input: {
  id: CategoryId;
  group: CategoryGroup;
  parent?: Category;
  name: string;
  now: Date;
  categories: readonly Category[];
  style?: StyleChange;
}): Result<Category> => {
  if (input.group.archivedAt !== null) return err(domainError("CategoryGroupArchived"));
  if (input.parent !== undefined) {
    const parent = usableParent(input.parent);
    if (!parent.ok) return parent;
  }
  const name = nameOf(input.name);
  if (!name.ok) return name;
  const siblings = { groupId: input.group.id, parentCategoryId: input.parent?.id ?? null };
  if (nameTakenIn(input.categories, siblings, name.value)) return err(domainError("CategoryNameTaken"));
  const style = ownStyle(siblings.parentCategoryId, input.group.style, input.style ?? {});
  if (!style.ok) return style;
  return ok({
    id: input.id,
    spaceId: input.group.spaceId,
    groupId: input.group.id,
    parentCategoryId: siblings.parentCategoryId,
    name: name.value,
    key: null,
    style: style.value,
    archivedAt: null,
    createdAt: input.now,
  });
};

/**
 * HU-E3-02, HU-E3-04, ruling P46: rename and/or move in one step; the key never changes. `parent` undefined keeps the
 * parent unless a `group` is given, which makes the category a category of that group; `null` makes it a category
 * of `group` (or of its own group); a category makes it that category's subcategory, in that category's group.
 * A subcategory always takes its parent's group, so the `group` it is given together with a `parent` is overridden.
 */
export const reviseCategory = (
  category: Category,
  change: {
    readonly name?: string;
    readonly group?: CategoryGroup;
    readonly parent?: Category | null;
    /** HU-E3-05: a new icon and/or color; `ValidationFailed` when the result is a subcategory. */
    readonly style?: StyleChange;
  },
  categories: readonly Category[],
): Result<Category> => {
  const name = change.name === undefined ? ok(category.name) : nameOf(change.name);
  if (!name.ok) return name;
  const target = change.group;
  if (target && target.id !== category.groupId && target.archivedAt !== null) {
    return err(domainError("CategoryGroupArchived"));
  }
  let groupId: CategoryGroupId = target?.id ?? category.groupId;
  let parentCategoryId: CategoryId | null =
    target === undefined && change.parent === undefined ? category.parentCategoryId : null;
  if (change.parent) {
    if (change.parent.id === category.id || hasSubcategories(categories, category.id)) {
      return err(domainError("CategoryDepthExceeded"));
    }
    const parent = usableParent(change.parent);
    if (!parent.ok) return parent;
    groupId = parent.value.groupId;
    parentCategoryId = parent.value.id;
  }
  if (nameTakenIn(categories, { groupId, parentCategoryId }, name.value, category.id)) {
    return err(domainError("CategoryNameTaken"));
  }
  // HU-E3-05: a category keeps the style it shows, so a subcategory that becomes one keeps a copy of its parent's.
  const style = ownStyle(parentCategoryId, shownStyle(category, categories), change.style ?? {});
  if (!style.ok) return style;
  return ok({ ...category, name: name.value, groupId, parentCategoryId, style: style.value });
};

/** HU-E3-04: a category's subcategories follow it to its group; the revised category comes first. */
export const movedTree = (revised: Category, categories: readonly Category[]): Category[] => [
  revised,
  ...categories
    .filter((c) => c.parentCategoryId === revised.id && c.groupId !== revised.groupId)
    .map((c) => ({ ...c, groupId: revised.groupId })),
];

export const archiveCategory = (category: Category, now: Date): Category =>
  category.archivedAt === null ? { ...category, archivedAt: now } : category;

/**
 * HU-E3-03, HU-E3-04, ruling P47: a subcategory comes back only under a live parent; a category restores alone.
 * The caller must pass the category's own parent when it is a subcategory (Task 9a's use case does): without
 * `parent` the parent rule is not checked, and this function does not compare it with `parentCategoryId`.
 */
export const restoreCategory = (
  category: Category,
  group: CategoryGroup,
  parent: Category | null = null,
): Result<Category> => {
  if (group.archivedAt !== null) return err(domainError("CategoryGroupArchived"));
  if (parent !== null && parent.archivedAt !== null) return err(domainError("ParentCategoryArchived"));
  return ok({ ...category, archivedAt: null });
};

/** HU-E3-04: archiving a category archives its subcategories, as archiving a group archives its categories. */
export const archivedTree = (category: Category, categories: readonly Category[], now: Date): Category[] => [
  archiveCategory(category, now),
  ...categories.filter((c) => c.parentCategoryId === category.id).map((c) => archiveCategory(c, now)),
];

/** HU-E3-03: archiving a group archives all its categories. */
export const archiveGroup = (
  group: CategoryGroup,
  categories: readonly Category[],
  now: Date,
): { group: CategoryGroup; categories: Category[] } => ({
  group: group.archivedAt === null ? { ...group, archivedAt: now } : group,
  categories: categories.filter((c) => c.groupId === group.id).map((c) => archiveCategory(c, now)),
});
