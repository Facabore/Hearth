"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [tree, setTree] = useState<readonly CategoryGroupDto[]>(groups);
  // A fresh read from the server (after `router.refresh()`) replaces what the screen holds.
  const [read, setRead] = useState(groups);
  if (groups !== read) {
    setRead(groups);
    setTree(groups);
  }
  const [kind, setKind] = useState<Kind>("EXPENSE");
  const [open, setOpen] = useState<Open | null>(null);
  const [addingGroup, setAddingGroup] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  // The categories whose restore is in flight: each button waits, so a double tap sends one request.
  const [restoring, setRestoring] = useState<ReadonlySet<string>>(new Set());

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

  /**
   * Shows what the API answered, or reads the tree again when the screen has nowhere to put it. The update builds on
   * the latest tree, so two answers that overlap both land; whether a home exists is asked of the rendered one.
   */
  const place = (saved: CategoryDto) => {
    setTree((current) => withCategory(current, saved) ?? current);
    if (withCategory(tree, saved) === null) router.refresh();
  };

  const restore = async (category: CategoryDto) => {
    setProblem(null);
    setRestoring((current) => new Set(current).add(category.id));
    try {
      const { data, error, response } = await api.POST(
        "/api/v1/spaces/{spaceId}/categories/{categoryId}/restore",
        { params: { path: { spaceId: space.id, categoryId: category.id } } },
      );
      if (data) place(data);
      else setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setRestoring((current) => {
      const next = new Set(current);
      next.delete(category.id);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-3 pb-3">
      <ScreenHeader
        backHref={`/spaces/${space.id}`}
        title={t("title")}
        subtitle={manage ? t("subtitle", { space: space.name }) : undefined}
        action={manage ? <Plus label={t("newGroup")} onClick={() => setAddingGroup(true)} /> : null}
      />
      {manage ? null : (
        <p className="rounded-2xl bg-track p-3 text-sm text-ink">{t("readOnly", { space: space.name })}</p>
      )}
      <ChoiceGroup
        label={t("kindLabel")}
        value={kind}
        onValueChange={(next) => {
          // A restore refusal belongs to the tab it happened on.
          setProblem(null);
          setKind(next);
        }}
        options={KINDS.map((value) => ({ value, label: t(`kind.${value}`) }))}
      />
      {shown.map((group) => (
        <section key={group.id} aria-labelledby={`group-${group.id}`} className="flex flex-col gap-1.5">
          {/* Board Categorías 01 (P292): a bold heading with its own "+" for a new category. */}
          <div className="flex items-center gap-2">
            <CategoryIcon icon={group.icon} color={group.color} size={28} />
            <h2
              id={`group-${group.id}`}
              className="min-w-0 flex-1 text-base font-semibold [overflow-wrap:anywhere] text-ink"
            >
              {group.name}
            </h2>
            {manage ? (
              <Plus
                label={t("addCategory", { group: group.name })}
                onClick={() => setOpen({ mode: "create", groupId: group.id })}
              />
            ) : null}
          </div>
          <ul className="divide-y divide-line rounded-2xl bg-surface px-3">
            {group.categories.length === 0 ? (
              <li className="flex min-h-12 items-center text-sm text-muted">{t("emptyGroup")}</li>
            ) : null}
            {group.categories.map((category) => (
              <li key={category.id}>
                <CategoryLine
                  category={category}
                  detail={
                    category.subcategories.length > 0
                      ? category.subcategories.map((sub) => sub.name).join(" · ")
                      : t("sheet.noSubcategories")
                  }
                  editLabel={manage ? t("edit", { name: category.name }) : null}
                  onEdit={() => setOpen({ mode: "edit", id: category.id })}
                />
              </li>
            ))}
          </ul>
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
                      disabled={restoring.has(category.id)}
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
          groups={shown}
          api={api}
          onClose={() => setOpen(null)}
          onSaved={place}
          onDeleted={(id) => setTree((current) => withoutCategory(current, id))}
          onGroupCreated={(group) => setTree((current) => withGroup(current, group))}
          onEditSubcategory={(id) => setOpen({ mode: "edit", id })}
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

/** A plain "+" of the board (P292): an icon on the page, 44 px, named by what it adds. */
function Plus({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  return (
    <Button size="iconCompact" variant="ghost" onClick={onClick}>
      <Icon name="plus" />
      <VisuallyHidden>{label}</VisuallyHidden>
    </Button>
  );
}

/**
 * A category's row (board Categorías 01, P292): its icon, name and subcategories or "Sin subcategorías"; for who
 * manages the tree, a button with a chevron that opens its sheet.
 */
function CategoryLine({
  category,
  detail,
  editLabel,
  onEdit,
}: {
  readonly category: CategoryDto;
  readonly detail: string;
  readonly editLabel: string | null;
  readonly onEdit: () => void;
}) {
  const body = (
    <>
      <CategoryIcon icon={category.icon} color={category.color} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-ink [overflow-wrap:anywhere]">{category.name}</span>
        <span className="text-sm [overflow-wrap:anywhere] text-muted">{detail}</span>
      </span>
      {editLabel ? (
        <span data-chevron className="shrink-0 text-ink">
          <Icon name="chevronRight" size={20} />
        </span>
      ) : null}
    </>
  );
  return editLabel ? (
    <button
      type="button"
      aria-label={editLabel}
      onClick={onEdit}
      className="flex min-h-14 w-full min-w-0 items-center gap-3 py-1.5 text-left"
    >
      {body}
    </button>
  ) : (
    <div className="flex min-h-14 min-w-0 items-center gap-3 py-1.5">{body}</div>
  );
}
