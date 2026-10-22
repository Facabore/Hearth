import Link from "next/link";
import { useTranslations } from "next-intl";
import type { SpaceDto } from "@/shared/ui/api/dto";
import { viewHref, viewsFor, type PlanView } from "./views";

/** Ruling P200: the views of the Plan tab as a row of links that scrolls inside itself, never the page. */
export function PlanTabs({
  space,
  view,
  period,
}: {
  readonly space: Pick<SpaceDto, "id" | "kind">;
  readonly view: PlanView;
  readonly period: string;
}) {
  const t = useTranslations("reports");
  return (
    <nav aria-label={t("tabs.label")} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {viewsFor(space.kind).map((item) => (
        <Link
          key={item}
          href={viewHref(space, item, period)}
          aria-current={item === view ? "page" : undefined}
          className={`flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-medium ${
            item === view ? "bg-accent-soft text-accent" : "border border-line bg-surface text-ink"
          }`}
        >
          {t(`view.${item}`)}
        </Link>
      ))}
    </nav>
  );
}
