import type { HearthCategory, HearthCategoryGroup } from "./mapping-proposals";
import type { SourceCategory, SourceSnapshot } from "./source-snapshot";

/** Where a planned group or category lands: a record Hearth holds (restored when archived), or a new one. */
export type GroupTarget =
  | { readonly kind: "existing"; readonly groupId: string; readonly archived: boolean }
  | { readonly kind: "new"; readonly name: string };

export type CategoryTarget =
  | { readonly kind: "existing"; readonly categoryId: string; readonly archived: boolean }
  | { readonly kind: "new"; readonly name: string };

export interface PlannedCategory {
  /** The source category whose movements land here: a subcategory, or the top-level category itself. */
  readonly sourceId: string;
  /**
   * #350: the planned category this one is a subcategory of (an income category's subcategory in Ingresos, planned
   * just after it); null for a category of the group.
   */
  readonly parentSourceId: string | null;
  readonly name: string;
  readonly icon: string | null;
  readonly target: CategoryTarget;
  /** A deleted source category still used by a movement (design §2.2): imported, then archived. */
  readonly deleted: boolean;
}

export interface PlannedGroup {
  /**
   * The top-level source categories this group stands for: one, several of the same name (income and expense, where
   * the space has no Ingresos group), or every income one (#350).
   */
  readonly sourceIds: readonly string[];
  readonly name: string;
  readonly icon: string | null;
  readonly target: GroupTarget;
  /** Its categories in the source's order. */
  readonly categories: readonly PlannedCategory[];
}

/** What earlier imports of this source linked each source id to (design §3.3), groups and categories apart. */
export interface CategoryLinks {
  readonly groups: ReadonlyMap<string, string>;
  readonly categories: ReadonlyMap<string, string>;
}

const key = (name: string): string => name.trim().toLowerCase();

const bySourceOrder = (a: SourceCategory, b: SourceCategory): number =>
  a.kind === b.kind ? a.order - b.order : a.kind === "EXPENSE" ? -1 : 1;

/** D11: the catalog key of the income group, the only group a movement of income is offered (#173). */
const INCOME_GROUP_KEY = "income";

/**
 * P337: the person's Money Manager categories as they had them. Each top-level expense category becomes a Hearth
 * group named as in Money Manager, in the source's order (new groups go last, so they keep that order); its
 * subcategories become that group's categories. A top-level category without subcategories becomes a group with one
 * category of the same name; one with subcategories that a movement still uses directly also gets a category of its
 * own name, first. Two top-level categories of the same name (ignoring case, as Hearth compares group names) share one
 * group.
 *
 * #350: groups carry no type, and only the catalog's Ingresos group is offered to an income (#173), so each top-level
 * income category becomes a category of that group, after the expense groups, with its subcategories as that
 * category's subcategories; an archived Ingresos is restored. A space without one keeps each income category a group
 * of its own, after the expense ones, as before.
 *
 * A group goes to what an earlier import linked it to, else to a group of the space with the same name, archived
 * ones included (group names stay taken when archived, so the confirm restores it); a category, likewise, to its
 * linked category, else to a category of the same name in that group (under its parent, for a subcategory). Pure.
 */
export const planCategoryGroups = (
  snapshot: Pick<SourceSnapshot, "categories" | "movements">,
  hearth: { readonly groups: readonly HearthCategoryGroup[]; readonly categories: readonly HearthCategory[] },
  links: CategoryLinks,
): PlannedGroup[] => {
  const used = new Set(snapshot.movements.map((m) => m.categorySourceId).filter((id) => id !== null));
  const childrenOf = new Map<string, SourceCategory[]>();
  for (const category of snapshot.categories) {
    if (category.parentSourceId === null) continue;
    const children = childrenOf.get(category.parentSourceId) ?? [];
    children.push(category);
    childrenOf.set(category.parentSourceId, children);
  }
  const tops = snapshot.categories.filter((c) => c.parentSourceId === null).sort(bySourceOrder);
  const income = hearth.groups.find((g) => g.key === INCOME_GROUP_KEY);

  const groupTargetOf = (sourceId: string, name: string): GroupTarget => {
    const linked = hearth.groups.find((g) => g.id === links.groups.get(sourceId));
    const found = linked ?? hearth.groups.find((g) => key(g.name) === key(name));
    return found === undefined
      ? { kind: "new", name: name.trim() }
      : { kind: "existing", groupId: found.id, archived: found.archived };
  };
  /**
   * Its link, else a category of its name in `groupId` under `parentId` (null: a category of the group). `within`
   * keeps only a link to that same place: an earlier import put an income category in a group of its own (P337), and
   * its link outlives an undo, so a new import still brings it to Ingresos (#350).
   */
  const categoryTargetOf = (
    source: SourceCategory,
    groupId: string | null,
    parentId: string | null,
    within = false,
  ): CategoryTarget => {
    const link = hearth.categories.find((c) => c.id === links.categories.get(source.sourceId));
    const linked =
      within && (link?.groupId !== groupId || link?.parentCategoryId !== parentId) ? undefined : link;
    const found =
      linked ??
      (groupId === null
        ? undefined
        : hearth.categories.find(
            (c) =>
              c.groupId === groupId && c.parentCategoryId === parentId && key(c.name) === key(source.name),
          ));
    return found === undefined
      ? { kind: "new", name: source.name.trim() }
      : { kind: "existing", categoryId: found.id, archived: found.archived };
  };
  // Two sources of one name in one group (income and expense "Others") land in the same category.
  const twinOf = (categories: readonly PlannedCategory[], target: CategoryTarget) =>
    categories.find(
      (c) =>
        c.parentSourceId === null &&
        (target.kind === "existing"
          ? c.target.kind === "existing" && c.target.categoryId === target.categoryId
          : c.target.kind === "new" && key(c.target.name) === key(target.name)),
    );

  const planned = new Map<string, PlannedGroup>();
  const groupFor = (groupKey: string, make: () => PlannedGroup): PlannedGroup => {
    const found = planned.get(groupKey);
    if (found !== undefined) return found;
    const made = make();
    planned.set(groupKey, made);
    return made;
  };
  const add = (group: PlannedGroup, category: PlannedCategory) => {
    (group.categories as PlannedCategory[]).push(category);
  };

  for (const top of tops) {
    if (income !== undefined && top.kind === "INCOME") continue;
    const target = groupTargetOf(top.sourceId, top.name);
    const groupKey = target.kind === "existing" ? `id:${target.groupId}` : `name:${key(target.name)}`;
    const group = groupFor(groupKey, () => ({
      sourceIds: [],
      name: top.name.trim(),
      icon: top.icon,
      target,
      categories: [],
    }));
    (group.sourceIds as string[]).push(top.sourceId);

    const groupId = target.kind === "existing" ? target.groupId : null;
    const children = (childrenOf.get(top.sourceId) ?? []).sort(bySourceOrder);
    const own = children.length === 0 || used.has(top.sourceId) ? [top] : [];
    for (const source of [...own, ...children]) {
      const target = categoryTargetOf(source, groupId, null);
      add(group, {
        sourceId: source.sourceId,
        parentSourceId: null,
        name: source.name.trim(),
        icon: source.icon ?? top.icon,
        target: twinOf(group.categories, target)?.target ?? target,
        deleted: source.deleted,
      });
    }
  }

  const incomeTops = income === undefined ? [] : tops.filter((top) => top.kind === "INCOME");
  if (income !== undefined && incomeTops.length > 0) {
    const group = groupFor(`id:${income.id}`, () => ({
      sourceIds: [],
      name: income.name,
      icon: null,
      target: { kind: "existing", groupId: income.id, archived: income.archived },
      categories: [],
    }));
    for (const top of incomeTops) {
      (group.sourceIds as string[]).push(top.sourceId);
      const own = categoryTargetOf(top, income.id, null, true);
      const target = twinOf(group.categories, own)?.target ?? own;
      add(group, {
        sourceId: top.sourceId,
        parentSourceId: null,
        name: top.name.trim(),
        icon: top.icon,
        target,
        deleted: top.deleted,
      });
      const parentId = target.kind === "existing" ? target.categoryId : null;
      for (const child of (childrenOf.get(top.sourceId) ?? []).sort(bySourceOrder)) {
        add(group, {
          sourceId: child.sourceId,
          parentSourceId: top.sourceId,
          name: child.name.trim(),
          icon: child.icon ?? top.icon,
          target: categoryTargetOf(child, parentId === null ? null : income.id, parentId, true),
          deleted: child.deleted,
        });
      }
    }
  }
  return [...planned.values()];
};

/**
 * P337, "Archivar las de Hearth que no uses": the seeded groups (D11) no movement uses, whole, and in a group that
 * stays, the seeded categories no movement uses; never a group or category the import lands on, and never one someone
 * created. A category counts as used when it or one of its subcategories is. Pure.
 */
export const unusedSeeded = (
  hearth: { readonly groups: readonly HearthCategoryGroup[]; readonly categories: readonly HearthCategory[] },
  used: ReadonlySet<string>,
  importedInto: { readonly groups: ReadonlySet<string>; readonly categories: ReadonlySet<string> },
): { readonly groups: string[]; readonly categories: string[] } => {
  const live = hearth.categories.filter((c) => !c.archived);
  const inUse = (category: HearthCategory): boolean =>
    used.has(category.id) ||
    importedInto.categories.has(category.id) ||
    live.some((c) => c.parentCategoryId === category.id && inUse(c));
  const groups: string[] = [];
  const categories: string[] = [];
  for (const group of hearth.groups) {
    if (group.archived || group.key === null) continue;
    const tops = live.filter((c) => c.groupId === group.id && c.parentCategoryId === null);
    if (!importedInto.groups.has(group.id) && !tops.some(inUse)) {
      groups.push(group.id);
      continue;
    }
    for (const category of tops) {
      if (category.key !== null && !inUse(category)) categories.push(category.id);
    }
  }
  return { groups, categories };
};

/** P337: the groups and categories Hearth holds that a plan lands on, which "Archivar…" never archives. */
export const existingTargetsOf = (
  plan: readonly PlannedGroup[],
): { readonly groups: ReadonlySet<string>; readonly categories: ReadonlySet<string> } => ({
  groups: new Set(plan.flatMap((g) => (g.target.kind === "existing" ? [g.target.groupId] : []))),
  categories: new Set(
    plan.flatMap((g) =>
      g.categories.flatMap((c) => (c.target.kind === "existing" ? [c.target.categoryId] : [])),
    ),
  ),
});
