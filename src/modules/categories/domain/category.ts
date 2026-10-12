import { domainError, err, ok, type Id, type Result } from "@/shared/kernel";

export type CategoryGroupId = Id<"CategoryGroup">;
export type CategoryId = Id<"Category">;

export interface CategoryGroup {
  readonly id: CategoryGroupId;
  readonly spaceId: string;
  readonly name: string;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
}

export interface Category {
  readonly id: CategoryId;
  readonly spaceId: string;
  readonly groupId: CategoryGroupId;
  readonly name: string;
  /** Stable catalog key of seeded categories (spec D11); null for categories users create. */
  readonly key: string | null;
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

const nameTakenIn = (categories: readonly Category[], groupId: string, name: string, exceptId?: string) =>
  categories.some((c) => c.groupId === groupId && c.id !== exceptId && sameName(c.name, name));

export const newGroup = (input: {
  id: CategoryGroupId;
  spaceId: string;
  name: string;
  now: Date;
  groups: readonly CategoryGroup[];
}): Result<CategoryGroup> => {
  const name = nameOf(input.name);
  if (!name.ok) return name;
  if (input.groups.some((g) => sameName(g.name, name.value)))
    return err(domainError("CategoryGroupNameTaken"));
  return ok({
    id: input.id,
    spaceId: input.spaceId,
    name: name.value,
    archivedAt: null,
    createdAt: input.now,
  });
};

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

export const newCategory = (input: {
  id: CategoryId;
  group: CategoryGroup;
  name: string;
  now: Date;
  categories: readonly Category[];
}): Result<Category> => {
  if (input.group.archivedAt !== null) return err(domainError("CategoryGroupArchived"));
  const name = nameOf(input.name);
  if (!name.ok) return name;
  if (nameTakenIn(input.categories, input.group.id, name.value)) return err(domainError("CategoryNameTaken"));
  return ok({
    id: input.id,
    spaceId: input.group.spaceId,
    groupId: input.group.id,
    name: name.value,
    key: null,
    archivedAt: null,
    createdAt: input.now,
  });
};

/** Rename and/or move in one step: the final name must be free in the final group; the key never changes. */
export const reviseCategory = (
  category: Category,
  change: { readonly name?: string; readonly group?: CategoryGroup },
  categories: readonly Category[],
): Result<Category> => {
  const name = change.name === undefined ? ok(category.name) : nameOf(change.name);
  if (!name.ok) return name;
  const target = change.group;
  if (target && target.id !== category.groupId && target.archivedAt !== null) {
    return err(domainError("CategoryGroupArchived"));
  }
  const groupId = target?.id ?? category.groupId;
  if (nameTakenIn(categories, groupId, name.value, category.id)) return err(domainError("CategoryNameTaken"));
  return ok({ ...category, name: name.value, groupId });
};

export const archiveCategory = (category: Category, now: Date): Category =>
  category.archivedAt === null ? { ...category, archivedAt: now } : category;

export const restoreCategory = (category: Category, group: CategoryGroup): Result<Category> =>
  group.archivedAt !== null
    ? err(domainError("CategoryGroupArchived"))
    : ok({ ...category, archivedAt: null });

/** HU-E3-03: archiving a group archives all its categories. */
export const archiveGroup = (
  group: CategoryGroup,
  categories: readonly Category[],
  now: Date,
): { group: CategoryGroup; categories: Category[] } => ({
  group: group.archivedAt === null ? { ...group, archivedAt: now } : group,
  categories: categories.filter((c) => c.groupId === group.id).map((c) => archiveCategory(c, now)),
});
