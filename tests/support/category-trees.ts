import type { TreeCategory, TreeGroup } from "@/modules/reporting/application";

/** A group of a space as a tree holds it; seeded groups carry their catalog key (HU-E3-05). */
export interface GroupSpec {
  readonly spaceId: string;
  readonly id: string;
  readonly name: string;
  readonly key?: string | null;
  readonly archived?: boolean;
}

/** A category of `group`; `parent` makes it a subcategory (HU-E3-04); it may keep a catalog key from the seed but always counts in its parent. */
export const node = (
  group: GroupSpec,
  id: string,
  name: string,
  options: { readonly key?: string; readonly parent?: string; readonly archived?: boolean } = {},
): TreeCategory => ({
  spaceId: group.spaceId,
  groupId: group.id,
  groupKey: group.key ?? null,
  groupName: group.name,
  groupArchived: group.archived ?? false,
  categoryId: id,
  categoryKey: options.key ?? null,
  categoryName: name,
  categoryArchived: options.archived ?? false,
  parentCategoryId: options.parent ?? null,
});

/** A group of a space as `groupsOf` lists it, also when it holds no live category (#130). */
export const groupOf = (group: GroupSpec): TreeGroup => ({
  spaceId: group.spaceId,
  groupId: group.id,
  groupKey: group.key ?? null,
  groupName: group.name,
  groupArchived: group.archived ?? false,
});

/** The groups of `nodes`, once each, in the order they first appear; the tree's own view of `groupsOf` (#130). */
export const groupsIn = (nodes: readonly TreeCategory[]): TreeGroup[] => {
  const groups = new Map<string, TreeGroup>();
  for (const n of nodes)
    groups.set(n.groupId, {
      spaceId: n.spaceId,
      groupId: n.groupId,
      groupKey: n.groupKey,
      groupName: n.groupName,
      groupArchived: n.groupArchived,
    });
  return [...groups.values()];
};

/** What was spent in one category of one space, as the ledger sums it per space and category. */
export const spent = (spaceId: string, categoryId: string, pesos: number) => ({
  spaceId,
  categoryId,
  amount: BigInt(pesos) * 100n,
});

const household = (id: string, name: string, key: string | null = null): GroupSpec => ({
  spaceId: "space-household",
  id,
  name,
  key,
});
export const HOUSING = household("grp-housing", "Housing", "housing");
export const FOOD = household("grp-food", "Food", "food");
export const TRANSPORT = household("grp-transport", "Transport", "transport");
export const LEISURE = household("grp-leisure", "Leisure", "leisure");
export const PETS = household("grp-pets", "Pets");

/**
 * HU-E7-06: Household's English seeded groups with the E7 fixture's categories (Groceries with Vegetables and Meat),
 * Fuel in Transport and the custom group Pets with Vet; the ids `reportingWorld` and `personalWorld` sum.
 */
export const HOUSEHOLD_TREE: readonly TreeCategory[] = [
  node(HOUSING, "cat-rent", "Rent", { key: "rent" }),
  node(HOUSING, "cat-utilities", "Utilities", { key: "utilities" }),
  node(FOOD, "cat-groceries", "Groceries", { key: "groceries" }),
  node(FOOD, "cat-vegetables", "Vegetables", { parent: "cat-groceries" }),
  node(FOOD, "cat-meat", "Meat", { parent: "cat-groceries" }),
  node(FOOD, "cat-restaurants", "Restaurants", { key: "restaurants" }),
  node(TRANSPORT, "cat-fuel", "Fuel", { key: "fuel" }),
  node(LEISURE, "cat-entertainment", "Entertainment", { key: "entertainment" }),
  node(PETS, "cat-vet", "Vet"),
];

export const ANA_FOOD: GroupSpec = { spaceId: "space-ana", id: "grp-ana-food", name: "Food", key: "food" };

/** Ana's personal space (`space-ana`): Food and Housing seeded, and her custom group Pets with Vet. */
export const ANA_TREE: readonly TreeCategory[] = [
  node(ANA_FOOD, "cat-ana-groceries", "Groceries", { key: "groceries" }),
  node(ANA_FOOD, "cat-ana-restaurants", "Restaurants", { key: "restaurants" }),
  node(
    { spaceId: "space-ana", id: "grp-ana-housing", name: "Housing", key: "housing" },
    "cat-ana-rent",
    "Rent",
    {
      key: "rent",
    },
  ),
  node({ spaceId: "space-ana", id: "grp-ana-pets", name: "Pets" }, "cat-ana-vet", "Vet"),
];
