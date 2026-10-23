import Link from "next/link";
import { useTranslations } from "next-intl";
import type { SpaceDto } from "@/shared/ui/api/dto";
import { viewHref } from "../views";

const WINDOWS = [6, 12] as const;

/** Ruling P219: the trend's two windows, six and twelve periods ending in `end`, as links; the current one is marked. */
export function TrendWindow({
  space,
  end,
  periods,
}: {
  readonly space: Pick<SpaceDto, "id" | "kind">;
  readonly end: string | undefined;
  readonly periods: 6 | 12;
}) {
  const t = useTranslations("reports.trend");
  return (
    <div className="flex gap-2">
      {WINDOWS.map((count) => (
        <Link
          key={count}
          href={`${viewHref(space, "trend", end)}${end ? "&" : "?"}periods=${count}`}
          aria-current={count === periods ? "page" : undefined}
          className={`flex min-h-11 items-center rounded-full px-4 text-sm font-medium ${
            count === periods ? "bg-accent-soft text-accent" : "border border-line bg-surface text-ink"
          }`}
        >
          {t("window", { count })}
        </Link>
      ))}
    </div>
  );
}
