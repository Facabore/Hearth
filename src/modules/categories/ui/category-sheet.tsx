"use client";

import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import type { PaletteKey } from "@/shared/kernel/style";
import { Button, Icon, ProblemNotice, Sheet, TextField } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { CategoryDto, CategoryGroupDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { CategoryIcon } from "./category-icon";
import { ColorRow } from "./color-row";
import { GroupSheet } from "./group-sheet";
import { IconPicker } from "./icon-picker";
import { isSameIcon, type IconChoice } from "./style-library";

type Answer = { data?: unknown; error?: unknown; response: Response };

/** What the sheet opens on: a new category of a group, or a category or subcategory to edit. */
export type CategorySheetTarget =
  | { readonly mode: "create"; readonly group: CategoryGroupDto }
  | {
      readonly mode: "edit";
      readonly category: CategoryDto;
      readonly parent: CategoryDto | null;
      readonly subcategories: readonly CategoryDto[];
    };

type Confirming = "archive" | "delete" | null;

/** The group dropdown's last choice: it opens the new-group sheet instead of choosing (no group id looks like it). */
const NEW_GROUP = "new-group";

/**
 * HU-E9-04 edit sheet (HU-E3-05), as board Categorías 02 lays it out (P292): the name beside the group dropdown (ending
 * in "New group"), the icon picker, the color row and the subcategories, then archive or delete beside the save. Choosing another group moves the category with its subcategories. A
 * subcategory shows its parent's style, so its sheet has no pickers, no group choice and no subcategories of its own.
 */
export function CategorySheet({
  spaceId,
  target,
  groups,
  onClose,
  onSaved,
  onDeleted,
  onGroupCreated,
  onEditSubcategory,
  api: injected,
}: {
  readonly spaceId: string;
  readonly target: CategorySheetTarget;
  /** The live groups the group choice offers. */
  readonly groups: readonly CategoryGroupDto[];
  readonly onClose: () => void;
  readonly onSaved: (saved: CategoryDto) => void;
  readonly onDeleted: (id: string) => void;
  readonly onGroupCreated: (group: Omit<CategoryGroupDto, "categories">) => void;
  /** A subcategory's chip opens its own sheet (the screen lists only categories, P292). */
  readonly onEditSubcategory: (id: string) => void;
  readonly api?: Api;
}) {
  const t = useTranslations("categories.sheet");
  const catalog = useTranslations("categories");
  const common = useTranslations("common");
  const id = useId();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const editing = target.mode === "edit" ? target.category : null;
  const isSub = target.mode === "edit" && target.parent !== null;
  const style = target.mode === "edit" ? target.category : target.group;
  const [name, setName] = useState(editing?.name ?? "");
  const [groupId, setGroupId] = useState(target.mode === "edit" ? target.category.groupId : target.group.id);
  const [icon, setIcon] = useState<IconChoice>(style.icon);
  const [color, setColor] = useState<PaletteKey>(style.color);
  const [newSub, setNewSub] = useState("");
  const [addingGroup, setAddingGroup] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  /** Runs one call; `then` gets its answer when it succeeded, and a failure is shown as its `errors.<Code>`. */
  const run = async (call: () => Promise<Answer>, then: (data: unknown) => void) => {
    setPending(true);
    setProblem(null);
    try {
      const { data, error, response } = await call();
      if (response.ok) {
        then(data);
        setPending(false);
        return;
      }
      setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };

  const path = { spaceId };
  const trimmed = name.trim();
  const styleChanged = !isSub && (!isSameIcon(icon, style.icon) || color !== style.color);
  // A name is always required; an edit saves only once something changed.
  const dirty =
    trimmed !== "" &&
    (editing === null || trimmed !== editing.name || groupId !== editing.groupId || styleChanged);

  const save = () =>
    editing === null
      ? run(
          () =>
            api.POST("/api/v1/spaces/{spaceId}/categories", {
              params: { path },
              body: { groupId, name: trimmed, icon, color },
            }),
          (data) => {
            onSaved(data as CategoryDto);
            onClose();
          },
        )
      : run(
          () =>
            api.PATCH("/api/v1/spaces/{spaceId}/categories/{categoryId}", {
              params: { path: { ...path, categoryId: editing.id } },
              body: {
                ...(trimmed !== editing.name ? { name: trimmed } : {}),
                ...(groupId !== editing.groupId ? { groupId } : {}),
                ...(styleChanged ? { icon, color } : {}),
              },
            }),
          (data) => {
            onSaved(data as CategoryDto);
            onClose();
          },
        );

  const addSubcategory = (parent: CategoryDto) =>
    run(
      () =>
        api.POST("/api/v1/spaces/{spaceId}/categories", {
          params: { path },
          body: { parentCategoryId: parent.id, name: newSub.trim() },
        }),
      (data) => {
        onSaved(data as CategoryDto);
        setNewSub("");
      },
    );

  const archive = (category: CategoryDto) =>
    run(
      () =>
        api.POST("/api/v1/spaces/{spaceId}/categories/{categoryId}/archive", {
          params: { path: { ...path, categoryId: category.id } },
        }),
      (data) => {
        onSaved(data as CategoryDto);
        onClose();
      },
    );

  const remove = (category: CategoryDto) =>
    run(
      () =>
        api.DELETE("/api/v1/spaces/{spaceId}/categories/{categoryId}", {
          params: { path: { ...path, categoryId: category.id } },
        }),
      () => {
        onDeleted(category.id);
        onClose();
      },
    );

  const liveSubs =
    target.mode === "edit" && !isSub ? target.subcategories.filter((sub) => sub.archivedAt === null) : [];

  const showGroup = editing !== null && !isSub;
  const actions = (
    <div data-testid="category-actions" className="flex flex-col gap-3">
      {problem ? (
        <div className="flex flex-col gap-2">
          <ProblemNotice problem={problem} />
          {problem.code === "CategoryInUse" && editing ? (
            <Button variant="secondary" disabled={pending} onClick={() => void archive(editing)}>
              <Icon name="archive" size={20} />
              {t("archiveInstead")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {editing && confirming ? (
        <div className="flex flex-col gap-2 rounded-2xl bg-track p-3">
          <p className="text-sm text-ink">
            {confirming === "archive"
              ? t("archiveConfirm", { name: editing.name })
              : t("deleteConfirm", { name: editing.name })}
            {confirming === "archive" && liveSubs.length > 0 ? ` ${t("archiveSubcategories")}` : null}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={confirming === "delete" ? "danger" : "primary"}
              disabled={pending}
              onClick={() => {
                setConfirming(null);
                void (confirming === "archive" ? archive(editing) : remove(editing));
              }}
            >
              {confirming === "archive" ? t("archive") : t("delete")}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              {common("cancel")}
            </Button>
          </div>
        </div>
      ) : editing ? (
        // Board Categorías 02 (P292): Archivar and Eliminar side by side, just above Guardar.
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" size="lg" disabled={pending} onClick={() => setConfirming("archive")}>
            {t("archive")}
          </Button>
          <Button variant="danger" size="lg" disabled={pending} onClick={() => setConfirming("delete")}>
            {t("delete")}
          </Button>
        </div>
      ) : null}
      <Button size="lg" className="w-full" disabled={pending || !dirty} onClick={() => void save()}>
        {editing ? t("save") : t("create")}
      </Button>
    </div>
  );

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={
        editing ? t("editTitle") : t("newTitle", { group: target.mode === "create" ? target.group.name : "" })
      }
      leading={<CategoryIcon icon={icon} color={color} size={40} />}
      footer={actions}
    >
      <div className="flex flex-col gap-2.5">
        {/* Board Categorías 02 (P292): the group is a dropdown beside the name, its last choice "Nuevo grupo". */}
        <div className={`grid gap-3 ${showGroup ? "grid-cols-2" : ""}`}>
          <TextField
            id={`${id}-name`}
            label={t("name")}
            value={name}
            maxLength={200}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
          {showGroup ? (
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={`${id}-group`} className="text-sm font-medium text-ink">
                {t("group")}
              </label>
              <select
                id={`${id}-group`}
                value={groupId}
                onChange={(event) => {
                  if (event.target.value === NEW_GROUP) setAddingGroup(true);
                  else setGroupId(event.target.value);
                }}
                className="h-[52px] w-full min-w-0 rounded-xl border border-field bg-surface px-3 text-base text-ink"
              >
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
                <option value={NEW_GROUP}>{catalog("newGroup")}</option>
              </select>
            </div>
          ) : null}
        </div>
        {isSub && target.mode === "edit" ? (
          <p className="rounded-2xl bg-track p-3 text-sm text-ink">
            {t("subcategoryStyle", { parent: target.parent!.name })}
          </p>
        ) : (
          <>
            <IconPicker value={icon} onValueChange={setIcon} />
            <ColorRow value={color} onValueChange={setColor} hint={catalog("colorHint")} />
          </>
        )}
        {editing && !isSub ? (
          <section aria-labelledby={`${id}-subs`} className="flex flex-col gap-1.5">
            <h3 id={`${id}-subs`} className="text-sm font-semibold text-ink">
              {t("subcategories")} <span className="font-normal text-muted">· {t("optional")}</span>
            </h3>
            {liveSubs.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {liveSubs.map((sub) => (
                  <li key={sub.id}>
                    <button
                      type="button"
                      aria-label={catalog("edit", { name: sub.name })}
                      onClick={() => onEditSubcategory(sub.id)}
                      className="flex min-h-11 items-center rounded-full bg-track px-4 text-sm [overflow-wrap:anywhere] text-ink"
                    >
                      {sub.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {addingSub ? (
              // At 320 px the button wraps under the field instead of squeezing it.
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1">
                  <TextField
                    id={`${id}-sub`}
                    label={t("newSubcategory")}
                    value={newSub}
                    maxLength={200}
                    autoComplete="off"
                    autoFocus
                    onChange={(event) => setNewSub(event.target.value)}
                  />
                </div>
                <Button
                  variant="secondary"
                  className="h-[52px]"
                  disabled={pending || newSub.trim() === ""}
                  onClick={() => void addSubcategory(editing)}
                >
                  {t("addSubcategory")}
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddingSub(true)}
                className="flex min-h-11 items-center gap-1 self-start rounded-full border border-dashed border-line px-4 text-sm font-medium text-accent"
              >
                <Icon name="plus" size={18} />
                {t("add")}
              </button>
            )}
          </section>
        ) : null}
      </div>
      {addingGroup ? (
        <GroupSheet
          spaceId={spaceId}
          api={api}
          onClose={() => setAddingGroup(false)}
          onCreated={(group) => {
            onGroupCreated(group);
            setGroupId(group.id);
            setAddingGroup(false);
          }}
        />
      ) : null}
    </Sheet>
  );
}
