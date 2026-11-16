"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, ChoiceGroup, Icon, ScreenHeader, Sheet, SymbolIcon } from "@/shared/ui";
import type { CategoryGroupDto } from "@/shared/ui/api/dto";
import { formatCount } from "@/shared/ui/format/count";
import type { CategoryMappingDto, ImportCategoryDto, ImportPreviewDto } from "./dto";
import { Column, Pinned, RefusalNotice, SectionTitle, type ScreenFormats } from "./parts";
import { useAdjust, type DraftPlace } from "./use-adjust";

interface Target {
  readonly name: string;
  /** "Alimentación › Mercado": a category under its group, a subcategory under its category. */
  readonly path: string;
}

/** Every live category and subcategory of the space by id, with the path its row names. */
const useTargets = (groups: readonly CategoryGroupDto[]) => {
  const t = useTranslations("portability.categories");
  const targets = new Map<string, Target>();
  for (const group of groups) {
    if (group.archivedAt !== null) continue;
    for (const category of group.categories) {
      if (category.archivedAt !== null) continue;
      targets.set(category.id, {
        name: category.name,
        path: t("path", { parent: group.name, name: category.name }),
      });
      for (const sub of category.subcategories) {
        if (sub.archivedAt !== null) continue;
        targets.set(sub.id, { name: sub.name, path: t("path", { parent: category.name, name: sub.name }) });
      }
    }
  }
  return targets;
};

/** The name a subcategory's "Nueva subcategoría en …" names: what its parent goes to. */
const parentTargetName = (
  category: ImportCategoryDto,
  categories: readonly ImportCategoryDto[],
  targets: ReadonlyMap<string, Target>,
): string => {
  const parent = categories.find((c) => c.sourceId === category.parentSourceId);
  if (!parent) return "";
  return parent.mapping.kind === "existing"
    ? (targets.get(parent.mapping.categoryId)?.name ?? parent.name)
    : parent.name;
};

function CategoryIcon({ icon }: { readonly icon: string | null }) {
  return (
    <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center text-xl">
      {icon ?? <SymbolIcon name="tag" size={20} className="text-muted" />}
    </span>
  );
}

/** One category's choice: a live category or subcategory of the space, or a new one (in a group, at the top level). */
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
  const [choice, setChoice] = useState(mapping.kind === "existing" ? mapping.categoryId : "new");
  const [group, setGroup] = useState(
    (mapping.kind === "new" ? mapping.groupId : null) ??
      liveGroups.find((g) => g.key === "other")?.id ??
      liveGroups[0]?.id ??
      "",
  );
  const { adjust, pending, refusal } = useAdjust(draft);
  const save = async () => {
    const next: CategoryMappingDto =
      choice === "new"
        ? { kind: "new", groupId: top ? group : null }
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
            ...[...targets].map(([id, target]) => ({ value: id, label: target.path })),
          ]}
          onValueChange={setChoice}
        />
        {choice === "new" && top && liveGroups.length > 0 ? (
          <ChoiceGroup
            label={t("group")}
            layout="chips"
            value={group}
            options={liveGroups.map((g) => ({ value: g.id, label: g.name }))}
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
 * space the name matched (or the catalog's, P330), or a new one in a group, or a new subcategory under what its parent
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
  /** The personal space's category tree. */
  readonly groups: readonly CategoryGroupDto[];
  readonly formats: ScreenFormats;
  readonly draft: DraftPlace;
}) {
  const t = useTranslations("portability.categories");
  const targets = useTargets(groups);
  const [editing, setEditing] = useState<string | null>(null);
  const editingCategory = preview.categories.find((c) => c.sourceId === editing);
  const targetText = (category: ImportCategoryDto) => {
    const { mapping } = category;
    if (mapping.kind === "existing")
      return { text: targets.get(mapping.categoryId)?.path ?? "", created: false };
    if (category.parentSourceId !== null) {
      return {
        text: t("newSub", { parent: parentTargetName(category, preview.categories, targets) }),
        created: true,
      };
    }
    return {
      text: t("newIn", { group: groups.find((g) => g.id === mapping.groupId)?.name ?? "" }),
      created: true,
    };
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
                      <span
                        className={`flex items-center gap-1 text-[13px] ${target.created ? "font-semibold text-accent" : "text-muted"}`}
                      >
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
