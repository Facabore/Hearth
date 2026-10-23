import type { MoneyDto, PersonalSpendingByGroupDto, SpendingByGroupDto } from "@/shared/ui/api/dto";

/** How a node is named: as stored, scoped to its space ("Household / Pets", HU-E9-11), or the "no subcategory" entry. */
export type NodeName =
  | { readonly kind: "plain"; readonly name: string }
  | { readonly kind: "scoped"; readonly space: string; readonly name: string }
  | { readonly kind: "noSubcategory" };

export interface SpendingNode {
  readonly id: string;
  readonly name: NodeName;
  readonly total: MoneyDto;
  readonly share: string;
  readonly archived: boolean;
  readonly children: readonly SpendingNode[];
}

type Groups = SpendingByGroupDto["groups"] | PersonalSpendingByGroupDto["groups"];
type Scoped = { readonly space?: { readonly name: string } | null };

const nameOf = (node: Scoped & { readonly name: string }): NodeName =>
  node.space
    ? { kind: "scoped", space: node.space.name, name: node.name }
    : { kind: "plain", name: node.name };

/**
 * HU-E7-06, ruling P215: the response as one tree, in its order, with ids stable across levels (a merged node has no
 * id, so its catalog key names it). A category's subcategory level exists only when it holds a named subcategory.
 */
export const treeOf = (groups: Groups): SpendingNode[] =>
  groups.map((g) => ({
    id: `g:${g.id ?? `key:${g.key ?? g.name}`}`,
    name: nameOf(g),
    total: g.total,
    share: g.share,
    archived: g.archived,
    children: g.categories.map((c) => ({
      id: `c:${c.id ?? `key:${c.key ?? c.name}`}`,
      name: nameOf(c),
      total: c.total,
      share: c.share,
      archived: c.archived,
      children: c.subcategories.some((s) => s.subcategoryId !== null)
        ? c.subcategories.map((s) => ({
            id: `s:${s.subcategoryId ?? "none"}`,
            name:
              s.subcategoryId === null
                ? ({ kind: "noSubcategory" } as const)
                : nameOf({ ...s, name: s.name ?? "" }),
            total: s.total,
            share: s.share,
            archived: s.archived,
            children: [],
          }))
        : [],
    })),
  }));

/**
 * The level under `path` (ids from the root), the node it opens (null at the root) and the trail to it. The path
 * stops at an id the level does not hold and above a node with nothing under it, so a stale URL still shows a level.
 */
export const levelAt = (
  tree: readonly SpendingNode[],
  path: readonly string[],
): { node: SpendingNode | null; rows: readonly SpendingNode[]; trail: readonly SpendingNode[] } => {
  let rows = tree;
  let node: SpendingNode | null = null;
  const trail: SpendingNode[] = [];
  for (const id of path) {
    const next = rows.find((n) => n.id === id);
    if (!next || next.children.length === 0) break;
    node = next;
    trail.push(next);
    rows = next.children;
  }
  return { node, rows, trail };
};
