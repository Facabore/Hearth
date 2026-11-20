"use client";

import { useState } from "react";
import type { Api } from "@/shared/ui/api/client";
import type { CategoryGroupDto } from "@/shared/ui/api/dto";
import { CategorySheet } from "./category-sheet";
import {
  activeTree,
  findCategory,
  groupsForKind,
  withCategory,
  withGroup,
  withoutCategory,
} from "./category-tree";

/** A change to the tree the API answered, applied to the latest one, so two answers that overlap both land. */
export type TreeUpdate = (groups: readonly CategoryGroupDto[]) => readonly CategoryGroupDto[];

/**
 * Ruling P346 (S6): HU-E9-04's «Editar categoría» opened on one category from outside the tree (the record form's
 * pencil). It edits as the Categories screen does, a subcategory's chip opening that subcategory's sheet, and hands
 * every answer back as a change to the tree; an archive or a delete also names what left the live tree.
 */
export function CategoryEditor({
  spaceId,
  groups,
  categoryId,
  api,
  onClose,
  onChange,
  onRemoved,
}: {
  readonly spaceId: string;
  /** The tree the caller holds; the sheet edits what it finds there. */
  readonly groups: readonly CategoryGroupDto[];
  readonly categoryId: string;
  readonly api?: Api;
  readonly onClose: () => void;
  readonly onChange: (update: TreeUpdate) => void;
  /** A category or subcategory archived or deleted from the sheet. */
  readonly onRemoved: (id: string) => void;
}) {
  const [open, setOpen] = useState(categoryId);
  const live = activeTree(groups);
  const found = findCategory(live, open);
  if (!found) return null;
  const node = found.group.categories.find((category) => category.id === open);
  // The group choice offers the groups the category's own kind lists (the income group only to an income one).
  const kind = found.group.key === "income" ? "INCOME" : "EXPENSE";
  return (
    <CategorySheet
      key={open}
      spaceId={spaceId}
      target={{
        mode: "edit",
        category: found.category,
        parent: found.parent,
        subcategories: node?.subcategories ?? [],
      }}
      groups={groupsForKind(live, kind)}
      {...(api ? { api } : {})}
      onClose={onClose}
      onSaved={(saved) => {
        onChange((current) => withCategory(current, saved) ?? current);
        if (saved.archivedAt !== null) onRemoved(saved.id);
      }}
      onDeleted={(id) => {
        onChange((current) => withoutCategory(current, id));
        onRemoved(id);
      }}
      onGroupCreated={(group) => onChange((current) => withGroup(current, group))}
      onEditSubcategory={setOpen}
    />
  );
}
