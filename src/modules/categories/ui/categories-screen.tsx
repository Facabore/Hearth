"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button, ChoiceGroup, Icon, ProblemNotice, ScreenHeader, VisuallyHidden } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { CategoryDto, CategoryGroupDto, SpaceDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { CategoryIcon } from "./category-icon";
import type { CategorySheetTarget } from "./category-sheet";
import {
  activeTree,
  categoryPath,
  findCategory,
  groupsForKind,
  withCategory,
  withGroup,
  withoutCategory,
} from "./category-tree";

// The sheets (pickers, the icon library and its labels) load on the first tap, not with the tree (P134, issue #72).
const CategorySheet = dynamic(() => import("./category-sheet").then((module) => module.CategorySheet), {
  ssr: false,
});
const GroupSheet = dynamic(() => import("./group-sheet").then((module) => module.GroupSheet), { ssr: false });

type Kind = "EXPENSE" | "INCOME";
const KINDS = ["EXPENSE", "INCOME"] as const satisfies readonly Kind[];
type Open =
  { readonly mode: "create"; readonly groupId: string } | { readonly mode: "edit"; readonly id: string };

/** HU-E1-05, HU-E9-04: only an OWNER or an ADMIN manages the tree (a personal space's owner is its OWNER). */
export const managesCategories = (role: SpaceDto["role"]): boolean => role === "OWNER" || role === "ADMIN";

/** The archived categories and subcategories of `groups`, in tree order; a subcategory of an archived parent too. */
const archivedOf = (groups: readonly CategoryGroupDto[]): CategoryDto[] =>
  groups.flatMap((group) =>
    group.categories.flatMap((category) => [
      ...(category.archivedAt !== null ? [category] : []),
      ...category.subcategories.filter((sub) => sub.archivedAt !== null),
    ]),
  );

/**
 * HU-E9-04, the Categories artboard as `/spaces/{spaceId}/categories`: the tree by group, with its subcategories nested
 * and collapsible, and an archived section. Every change shows at once from what the API answered. A role that does
 * not manage the tree sees it read-only: no create, edit, move, archive, restore or delete control.
 */
export function CategoryTree({
  space,
  groups,
  api: injected,
}: {
  readonly space: SpaceDto;
  /** The whole tree, archived groups and categories included (`?archived=true`). */
  readonly groups: readonly CategoryGroupDto[];
  readonly api?: Api;
}) {
  const t = useTranslations("categories");
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const manage = managesCategories(space.role);
  const [tree, setTree] = useState<readonly CategoryGroupDto[]>(groups);
  const [kind, setKind] = useState<Kind>("EXPENSE");
  const [open, setOpen] = useState<Open | null>(null);
  const [addingGroup, setAddingGroup] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<Problem | null>(null);

  const live = activeTree(tree);
  const shown = groupsForKind(live, kind);
  const archived = archivedOf(groupsForKind(tree, kind).filter((group) => group.archivedAt === null));

  const target = ((): CategorySheetTarget | null => {
    if (!open) return null;
    if (open.mode === "create") {
      const group = live.find((g) => g.id === open.groupId);
      return group ? { mode: "create", group } : null;
    }
    const found = findCategory(live, open.id);
    if (!found) return null;
    const node = found.group.categories.find((category) => category.id === open.id);
    return {
      mode: "edit",
      category: found.category,
      parent: found.parent,
      subcategories: node?.subcategories ?? [],
    };
  })();

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const restore = async (category: CategoryDto) => {
    setProblem(null);
    try {
      const { data, error, response } = await api.POST(
        "/api/v1/spaces/{spaceId}/categories/{categoryId}/restore",
        { params: { path: { spaceId: space.id, categoryId: category.id } } },
      );
      if (data) setTree((current) => withCategory(current, data));
      else setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-4">
      <ScreenHeader
        backHref={`/spaces/${space.id}`}
        title={t("title")}
        subtitle={manage ? t("subtitle") : undefined}
        action={
          manage ? (
            <Button size="icon" variant="secondary" onClick={() => setAddingGroup(true)}>
              <Icon name="plus" />
              <VisuallyHidden>{t("newGroup")}</VisuallyHidden>
            </Button>
          ) : null
        }
      />
      {manage ? null : (
        <p className="rounded-2xl bg-track p-3 text-sm text-ink">{t("readOnly", { space: space.name })}</p>
      )}
      <ChoiceGroup
        label={t("kindLabel")}
        value={kind}
        onValueChange={setKind}
        options={KINDS.map((value) => ({ value, label: t(`kind.${value}`) }))}
      />
      {shown.map((group) => (
        <section key={group.id} aria-labelledby={`group-${group.id}`} className="flex flex-col gap-1.5">
          <h2 id={`group-${group.id}`} className="flex items-center gap-2 text-sm font-semibold text-muted">
            <CategoryIcon icon={group.icon} color={group.color} size={28} />
            <span className="min-w-0 [overflow-wrap:anywhere]">{group.name}</span>
          </h2>
          <ul className="divide-y divide-line rounded-2xl bg-surface px-3">
            {group.categories.length === 0 ? (
              <li className="flex min-h-12 items-center text-sm text-muted">{t("emptyGroup")}</li>
            ) : null}
            {group.categories.map((category) => {
              const subs = category.subcategories;
              const isOpen = expanded.has(category.id);
              return (
                <li key={category.id} className="flex flex-col">
                  <div className="flex min-h-14 items-center gap-1">
                    <CategoryLine
                      category={category}
                      detail={subs.length > 0 ? t("subcategoryCount", { count: subs.length }) : null}
                      editLabel={manage ? t("edit", { name: category.name }) : null}
                      onEdit={() => setOpen({ mode: "edit", id: category.id })}
                    />
                    {subs.length > 0 ? (
                      <Button
                        size="iconCompact"
                        variant="ghost"
                        aria-expanded={isOpen}
                        aria-controls={isOpen ? `subs-${category.id}` : undefined}
                        onClick={() => toggle(category.id)}
                      >
                        <Icon name="chevronDown" className={isOpen ? "rotate-180" : undefined} />
                        <VisuallyHidden>{t("subcategoriesToggle", { name: category.name })}</VisuallyHidden>
                      </Button>
                    ) : null}
                  </div>
                  {subs.length > 0 && isOpen ? (
                    <ul
                      id={`subs-${category.id}`}
                      aria-label={t("subcategoriesToggle", { name: category.name })}
                      className="mb-2 ml-10 border-l border-line pl-3"
                    >
                      {subs.map((sub) => (
                        <li key={sub.id} className="flex min-h-11 items-center gap-2">
                          {/* HU-E3-05: a subcategory shows its parent's style. */}
                          <CategoryIcon icon={sub.icon} color={sub.color} size={24} />
                          {manage ? (
                            <button
                              type="button"
                              aria-label={t("edit", { name: sub.name })}
                              onClick={() => setOpen({ mode: "edit", id: sub.id })}
                              className="flex min-h-11 flex-1 items-center text-left text-sm text-ink [overflow-wrap:anywhere]"
                            >
                              {sub.name}
                            </button>
                          ) : (
                            <span className="text-sm text-ink [overflow-wrap:anywhere]">{sub.name}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {manage ? (
            <Button
              variant="ghost"
              className="self-start"
              aria-label={t("addCategory", { group: group.name })}
              onClick={() => setOpen({ mode: "create", groupId: group.id })}
            >
              <Icon name="plus" size={20} />
              {t("addCategoryShort")}
            </Button>
          ) : null}
        </section>
      ))}
      {archived.length > 0 ? (
        <section aria-labelledby="archived-categories" className="flex flex-col gap-1.5">
          <h2 id="archived-categories" className="text-sm font-semibold text-muted">
            {t("archived.title")}
          </h2>
          {problem ? <ProblemNotice problem={problem} /> : null}
          <ul className="divide-y divide-line rounded-2xl bg-surface px-3">
            {archived.map((category) => {
              const name = categoryPath(tree, category.id) ?? category.name;
              return (
                <li key={category.id} className="flex min-h-14 items-center gap-3">
                  <CategoryIcon icon={category.icon} color={category.color} />
                  <span className="min-w-0 flex-1 text-ink [overflow-wrap:anywhere]">{name}</span>
                  {manage ? (
                    <Button
                      variant="secondary"
                      aria-label={t("archived.restore", { name })}
                      onClick={() => void restore(category)}
                    >
                      {t("archived.restoreShort")}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {target ? (
        <CategorySheet
          key={open!.mode === "edit" ? open!.id : `new-${open!.groupId}`}
          spaceId={space.id}
          target={target}
          groups={groupsForKind(live, kind)}
          api={api}
          onClose={() => setOpen(null)}
          onSaved={(saved) => setTree((current) => withCategory(current, saved))}
          onDeleted={(id) => setTree((current) => withoutCategory(current, id))}
          onGroupCreated={(group) => setTree((current) => withGroup(current, group))}
        />
      ) : null}
      {addingGroup ? (
        <GroupSheet
          spaceId={space.id}
          api={api}
          onClose={() => setAddingGroup(false)}
          onCreated={(group) => {
            setTree((current) => withGroup(current, group));
            setAddingGroup(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** A category's row: its icon, name and subcategory count; a button that opens its sheet for who manages the tree. */
function CategoryLine({
  category,
  detail,
  editLabel,
  onEdit,
}: {
  readonly category: CategoryDto;
  readonly detail: string | null;
  readonly editLabel: string | null;
  readonly onEdit: () => void;
}) {
  const body = (
    <>
      <CategoryIcon icon={category.icon} color={category.color} />
      <span className="flex min-w-0 flex-col">
        <span className="text-ink [overflow-wrap:anywhere]">{category.name}</span>
        {detail ? <span className="text-sm text-muted">{detail}</span> : null}
      </span>
    </>
  );
  return editLabel ? (
    <button
      type="button"
      aria-label={editLabel}
      onClick={onEdit}
      className="flex min-h-14 min-w-0 flex-1 items-center gap-3 text-left"
    >
      {body}
    </button>
  ) : (
    <div className="flex min-h-14 min-w-0 flex-1 items-center gap-3">{body}</div>
  );
}
