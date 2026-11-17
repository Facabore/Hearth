"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, ScreenHeader, Switch } from "@/shared/ui";
import type { CategoryGroupDto } from "@/shared/ui/api/dto";
import { formatCount } from "@/shared/ui/format/count";
import type { ImportCategoryGroupDto, ImportPreviewDto } from "./dto";
import { Column, Pinned, RefusalNotice, type ScreenFormats } from "./parts";
import { useAdjust, type DraftPlace } from "./use-adjust";

/** Until the person widens the list, the board shows this many groups and "y N grupos más". */
const FIRST = 9;

/** How many seeded names the switch's note lists before "…". */
const NAMED = 2;

/** A group of one category of its own name: Money Manager's category with no subcategories, picked in one tap. */
const isDirect = (group: ImportCategoryGroupDto) =>
  group.categories.length === 1 &&
  group.categories[0]!.name.trim().toLowerCase() === group.name.trim().toLowerCase();

/**
 * D28, P337, board 4 "Tus categorías": the person's Money Manager categories as they come, read-only. Each top-level
 * category is a group ("Food · 9") with its categories below, in the file's order; one without subcategories is
 * picked directly. The switch "Archivar las de Hearth que no uses", on by default, archives the seeded groups and
 * categories no movement uses (named in its note), which can be restored; turning it adjusts the draft.
 */
export function ImportCategoriesScreen({
  backHref,
  preview,
  formats,
  draft,
}: {
  readonly backHref: string;
  readonly preview: ImportPreviewDto;
  /** The personal space's category tree (no longer read: the preview names what the switch archives). */
  readonly groups?: readonly CategoryGroupDto[];
  readonly formats: ScreenFormats;
  readonly draft: DraftPlace;
}) {
  const t = useTranslations("portability.categories");
  const busy = useTranslations("portability")("busy");
  const { adjust, pending, refusal } = useAdjust(draft);
  const { groups, archiveUnusedCategories, unusedSeeded } = preview.categories;
  const [all, setAll] = useState(groups.length <= FIRST);
  const shown = all ? groups : groups.slice(0, FIRST);
  const rest = groups.length - shown.length;
  const seededNames = [...unusedSeeded.groups, ...unusedSeeded.categories].map((s) => s.name);
  const note =
    seededNames.length === 0
      ? t("archiveUnusedNone")
      : t("archiveUnusedNote", {
          names: `${seededNames.slice(0, NAMED).join(", ")}${seededNames.length > NAMED ? "…" : ""}`,
        });
  return (
    <Column>
      <ScreenHeader backHref={backHref} title={t("header")} />
      <div className="flex flex-col gap-1">
        <h2 className="text-[22px] leading-tight font-semibold text-ink">{t("title")}</h2>
        <p className="text-[15px] text-muted">{t("intro")}</p>
      </div>
      <ul className="flex flex-col gap-3">
        {shown.map((group, index) => (
          <li key={`${index}-${group.name}`} className="flex flex-col">
            <h3 className="text-[15px] font-medium [overflow-wrap:anywhere] text-ink">
              {isDirect(group)
                ? group.name
                : t("group", { name: group.name, count: formatCount(group.categories.length, formats) })}
            </h3>
            <p className="text-[13px] [overflow-wrap:anywhere] text-muted">
              {isDirect(group) ? t("direct") : group.categories.map((c) => c.name).join(", ")}
            </p>
          </li>
        ))}
      </ul>
      {rest > 0 ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="min-h-11 self-start text-[15px] font-semibold text-accent"
        >
          {t("more", { n: rest, count: formatCount(rest, formats) })}
        </button>
      ) : null}
      <Switch
        id="archive-unused-categories"
        label={t("archiveUnused")}
        description={note}
        checked={archiveUnusedCategories}
        disabled={pending}
        onCheckedChange={(checked) => void adjust({ archiveUnusedCategories: checked })}
      />
      {refusal ? <RefusalNotice refusal={refusal} tooMany={busy} /> : null}
      <Pinned>
        <Button size="lg" asChild>
          <Link href={backHref}>{t("done")}</Link>
        </Button>
      </Pinned>
    </Column>
  );
}
