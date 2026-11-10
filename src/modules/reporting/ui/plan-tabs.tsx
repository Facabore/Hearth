import Link from "next/link";
import { useTranslations } from "next-intl";
import type { SpaceDto } from "@/shared/ui/api/dto";
import { viewHref, viewsFor, type PlanView } from "./views";

/** Ruling P272 (X4 of the E9 boards): the chosen chip is filled with ink, the others are outlined. */
export const chipClass = (selected: boolean): string =>
  `flex min-h-11 shrink-0 items-center rounded-full px-3.5 text-sm font-medium ${
    selected ? "bg-ink text-surface" : "border border-line bg-surface text-ink"
  }`;

/**
 * Ruling P200: the views of the Plan tab as a row of links. Issue #174 (decision U3): the row wraps to a second line
 * instead of scrolling, so every view, the current one included, is on screen at 320 px; the boards (P272) fit the
 * personal space's four on one row at 390 px.
 */
export function PlanTabs({
  space,
  view,
  period,
}: {
  readonly space: Pick<SpaceDto, "id" | "kind">;
  readonly view: PlanView;
  /** The period label the links keep; a view that is not a period view (the calendar) passes none. */
  readonly period?: string;
}) {
  const t = useTranslations("reports");
  return (
    <nav aria-label={t("tabs.label")} className="flex flex-wrap gap-2">
      {viewsFor(space.kind).map((item) => (
        <Link
          key={item}
          href={viewHref(space, item, period)}
          // P318: a view of the Plan replaces the one shown, so Back leaves the Plan instead of walking its views.
          replace
          aria-current={item === view ? "page" : undefined}
          className={chipClass(item === view)}
        >
          {t(`view.${item}`)}
        </Link>
      ))}
    </nav>
  );
}
