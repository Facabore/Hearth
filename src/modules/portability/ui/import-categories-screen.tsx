"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, ChoiceGroup, Icon, ScreenHeader, Sheet, SymbolIcon } from "@/shared/ui";
import type { CategoryGroupDto } from "@/shared/ui/api/dto";
import { formatCount } from "@/shared/ui/format/count";
import type { CategoryMappingInputDto, ImportCategoryDto, ImportPreviewDto } from "./dto";
import { Column, Pinned, RefusalNotice, SectionTitle, type ScreenFormats } from "./parts";
import { useAdjust, type DraftPlace } from "./use-adjust";

/** The value the group choice gives "the import's own group", which the API names with a null `groupId`. */
const IMPORT_GROUP = "import";

interface Target {
  readonly id: string;
  readonly name: string;
  /** "Alimentación › Mercado": a category under its group, a subcategory under its category. */
  readonly path: string;
  /** The category a subcategory sits under; null for a category. */
  readonly parentId: string | null;
  readonly archived: boolean;
}

/** Every category and subcategory of the space by id, archived ones too, with the path its row names. */
const useTargets = (groups: readonly CategoryGroupDto[]) => {
  const t = useTranslations("portability.categories");
  const targets = new Map<string, Target>();
  for (const group of groups) {
    for (const category of group.categories) {
      const archived = group.archivedAt !== null || category.archivedAt !== null;
      targets.set(category.id, {
        id: category.id,
        name: category.name,
        path: t("path", { parent: group.name, name: category.name }),
        parentId: null,
        archived,
      });
      for (const sub of category.subcategories) {
        targets.set(sub.id, {
          id: sub.id,
          name: sub.name,
          path: t("path", { parent: category.name, name: sub.name }),
          parentId: category.id,
          archived: archived || sub.archivedAt !== null,
        });
      }
    }
  }
  return targets;
};

const parentOf = (category: ImportCategoryDto, categories: readonly ImportCategoryDto[]) =>
  categories.find((c) => c.sourceId === category.parentSourceId);

/** The name a subcategory's "Nueva subcategoría en …" names: what its parent goes to. */
const parentTargetName = (
  category: ImportCategoryDto,
  categories: readonly ImportCategoryDto[],
  targets: ReadonlyMap<string, Target>,
): string => {
  const parent = parentOf(category, categories);
  if (!parent) return "";
  if (parent.mapping.kind === "existing") return targets.get(parent.mapping.categoryId)?.name ?? parent.name;
  return parent.mapping.name ?? parent.name;
};

/**
 * The categories a source can go to without the confirm refusing it (design §3.2, D20's three levels): a category for
 * a category of the file, since its subcategories go under it; for a subcategory, a subcategory of the category its
 * parent goes to (none while the parent is new). Live ones, and the archived one it is mapped to already, which an
 * undone import of this file created and a confirm restores. Hearth's categories serve incomes and expenses alike.
 */
const candidatesFor = (
  category: ImportCategoryDto,
  categories: readonly ImportCategoryDto[],
  targets: ReadonlyMap<string, Target>,
): Target[] => {
  const { mapping } = category;
  const usable = (target: Target) =>
    !target.archived || (mapping.kind === "existing" && mapping.categoryId === target.id);
  if (category.parentSourceId === null) {
    return [...targets.values()].filter((target) => target.parentId === null && usable(target));
  }
  const parent = parentOf(category, categories);
  if (parent?.mapping.kind !== "existing") return [];
  const under = parent.mapping.categoryId;
  return [...targets.values()].filter((target) => target.parentId === under && usable(target));
};

function CategoryIcon({ icon }: { readonly icon: string | null }) {
  return (
    <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center text-xl">
      {icon ?? <SymbolIcon name="tag" size={20} className="text-muted" />}
    </span>
  );
}

/** One category's choice: a category the API accepts for it, or a new one (in a group, at the top level). */
function CategorySheet({
  category,
  categories,
  groups,
  targets,
  onClose,
  draft,
}: {
  readonly category: ImportCategoryDto;
  readonly categories: readonly ImportCategoryDto[];
  readonly groups: readonly CategoryGroupDto[];
  readonly targets: ReadonlyMap<string, Target>;
  readonly onClose: () => void;
  readonly draft: DraftPlace;
}) {
  const t = useTranslations("portability.categories");
  const busy = useTranslations("portability")("busy");
  const { mapping } = category;
  const top = category.parentSourceId === null;
  const liveGroups = groups.filter((g) => g.archivedAt === null);
  const candidates = candidatesFor(category, categories, targets);
  const [choice, setChoice] = useState(mapping.kind === "existing" ? mapping.categoryId : "new");
  const [group, setGroup] = useState(
    mapping.kind === "new" ? (mapping.groupId ?? IMPORT_GROUP) : IMPORT_GROUP,
  );
  const { adjust, pending, refusal } = useAdjust(draft);
  const save = async () => {
    // A new category keeps the name the preview settled on; one that was not new yet leaves it to the API.
    const next: CategoryMappingInputDto =
      choice === "new"
        ? {
            kind: "new",
            groupId: top && group !== IMPORT_GROUP ? group : null,
            ...(mapping.kind === "new" && mapping.name !== undefined ? { name: mapping.name } : {}),
          }
        : { kind: "existing", categoryId: choice };
    if (await adjust({ categories: { [category.sourceId]: next } })) onClose();
  };
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={category.name}
      footer={
        <Button size="lg" disabled={pending} onClick={() => void save()}>
          {t("save")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <ChoiceGroup
          label={t("sheetChoice")}
          layout="list"
          value={choice}
          options={[
            {
              value: "new",
              label: top
                ? t("createNew")
                : t("createSub", { parent: parentTargetName(category, categories, targets) }),
            },
            ...candidates.map((target) => ({
              value: target.id,
              label: target.path,
              description: target.archived ? t("restored") : undefined,
            })),
          ]}
          onValueChange={setChoice}
        />
        {choice === "new" && top ? (
          <ChoiceGroup
            label={t("group")}
            layout="chips"
            value={group}
            options={[
              { value: IMPORT_GROUP, label: t("importGroup") },
              ...liveGroups.map((g) => ({ value: g.id, label: g.name })),
            ]}
            onValueChange={setGroup}
          />
        ) : null}
        {refusal ? <RefusalNotice refusal={refusal} tooMany={busy} /> : null}
      </div>
    </Sheet>
  );
}

/** A kind's categories, each top-level one followed by its subcategories, as the board lists them. */
const ordered = (categories: readonly ImportCategoryDto[], kind: ImportCategoryDto["kind"]) => {
  const ofKind = categories.filter((c) => c.kind === kind);
  const tops = ofKind.filter((c) => c.parentSourceId === null);
  const placed = tops.flatMap((topLevel) => [
    topLevel,
    ...ofKind.filter((c) => c.parentSourceId === topLevel.sourceId),
  ]);
  const placedIds = new Set(placed.map((c) => c.sourceId));
  return [...placed, ...ofKind.filter((c) => !placedIds.has(c.sourceId))];
};

/**
 * D28, board "5 · Importar · categorías": the file's categories by kind, each with what it goes to: a category of the
 * space the name matched (or the catalog's, P330, or one an undone import archived, restored), a new one in a group
 * (the import's own by default) under the name the confirm will give it, or a new subcategory under what its parent
 * goes to. The emoji a name started with is the category's icon (D22). Tapping a row opens its choice.
 */
export function ImportCategoriesScreen({
  backHref,
  preview,
  groups,
  formats,
  draft,
}: {
  readonly backHref: string;
  readonly preview: ImportPreviewDto;
  /** The personal space's category tree, archived groups and categories included. */
  readonly groups: readonly CategoryGroupDto[];
  readonly formats: ScreenFormats;
  readonly draft: DraftPlace;
}) {
  const t = useTranslations("portability.categories");
  const targets = useTargets(groups);
  const [editing, setEditing] = useState<string | null>(null);
  const editingCategory = preview.categories.find((c) => c.sourceId === editing);
  const targetText = (
    category: ImportCategoryDto,
  ): { text: string; tone: "muted" | "created" | "missing" } => {
    const { mapping } = category;
    if (mapping.kind === "existing") {
      const target = targets.get(mapping.categoryId);
      if (!target) return { text: t("missing"), tone: "missing" };
      return {
        text: target.archived ? t("restoredPath", { path: target.path }) : target.path,
        tone: "muted",
      };
    }
    if (category.parentSourceId !== null) {
      return {
        text: t("newSub", { parent: parentTargetName(category, preview.categories, targets) }),
        tone: "created",
      };
    }
    const group =
      mapping.groupId === null
        ? t("importGroup")
        : (groups.find((g) => g.id === mapping.groupId)?.name ?? t("importGroup"));
    const renamed = mapping.name !== undefined && mapping.name !== category.name;
    return {
      text: renamed ? t("newInAs", { group, name: mapping.name! }) : t("newIn", { group }),
      tone: "created",
    };
  };
  const tones = {
    muted: "text-muted",
    created: "font-semibold text-accent",
    missing: "font-semibold text-danger",
  };
  const sections = (["EXPENSE", "INCOME"] as const)
    .map((kind) => ({ kind, items: ordered(preview.categories, kind) }))
    .filter((section) => section.items.length > 0);
  return (
    <Column>
      <ScreenHeader backHref={backHref} title={t("title")} />
      <p className="text-[15px] text-muted">{t("intro")}</p>
      {sections.map((section) => (
        <section key={section.kind} aria-labelledby={`import-${section.kind}`} className="flex flex-col">
          <SectionTitle id={`import-${section.kind}`}>
            {t(section.kind === "EXPENSE" ? "expense" : "income", {
              count: formatCount(section.items.length, formats),
            })}
          </SectionTitle>
          <ul className="divide-y divide-line">
            {section.items.map((category) => {
              const target = targetText(category);
              return (
                <li key={category.sourceId}>
                  <button
                    type="button"
                    onClick={() => setEditing(category.sourceId)}
                    className={`flex min-h-row-lg w-full items-center gap-3 py-2 text-left ${category.parentSourceId === null ? "" : "pl-11"}`}
                  >
                    {category.parentSourceId === null ? <CategoryIcon icon={category.icon} /> : null}
                    <span className="flex min-w-0 flex-1 flex-col [overflow-wrap:anywhere]">
                      <span className="text-[15px] text-ink">{category.name}</span>
                      <span className={`flex items-center gap-1 text-[13px] ${tones[target.tone]}`}>
                        <Icon name="swap" size={14} className="shrink-0" />
                        <span>{target.text}</span>
                      </span>
                      {category.archived ? (
                        <span className="text-[13px] text-muted">{t("archived")}</span>
                      ) : null}
                    </span>
                    <Icon name="chevronRight" size={20} className="shrink-0 text-muted" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {editingCategory ? (
        <CategorySheet
          category={editingCategory}
          categories={preview.categories}
          groups={groups}
          targets={targets}
          onClose={() => setEditing(null)}
          draft={draft}
        />
      ) : null}
      <Pinned>
        <Button size="lg" asChild>
          <Link href={backHref}>{t("done")}</Link>
        </Button>
      </Pinned>
    </Column>
  );
}
