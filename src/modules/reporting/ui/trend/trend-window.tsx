import Link from "next/link";
import { useTranslations } from "next-intl";
import type { SpaceDto } from "@/shared/ui/api/dto";
import { chipClass } from "../plan-tabs";
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
          replace
          aria-current={count === periods ? "page" : undefined}
          className={chipClass(count === periods)}
        >
          {t("window", { count })}
        </Link>
      ))}
    </div>
  );
}
