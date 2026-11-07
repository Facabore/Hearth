import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { shownAmount, useAmountsHidden } from "@/modules/spaces/ui";
import { SpaceChip } from "@/shared/ui/atoms/space-chip";
import type { MoneyDto, SpaceDto, TransactionPageDto } from "@/shared/ui/api/dto";
import { formatDate, type Formats } from "@/shared/ui/format/formatters";
import { periodName } from "@/shared/ui/time/period-name";
import type { UnifiedMonth } from "./feed";

/**
 * Ruling P306 (boards "Inicio personal · todo en un lugar · tu parte" and "… · lo que pagaste"): the personal Inicio's
 * headline for someone with other spaces. Her share of the period by default, what she paid on the switch, broken down
 * per space (the personal one by name, the others by their chip), and Ver por categoría into Mi consumo. It draws in
 * the first paint, so its height never moves what is under it.
 */
export function UnifiedSummary({
  unified,
  page,
  policy,
  formats,
  personId,
}: {
  readonly unified: UnifiedMonth;
  readonly page: TransactionPageDto;
  readonly policy: SpaceDto["periodPolicy"];
  readonly formats: Formats;
  /** Ruling P278: Inicio's eye hides every amount. */
  readonly personId: string;
}) {
  const t = useTranslations("home");
  const common = useTranslations("common");
  const hidden = useAmountsHidden(personId);
  const money = (amount: MoneyDto) => shownAmount(amount, hidden, formats);
  const [mode, setMode] = useState<"share" | "paid">("share");
  const paid = mode === "paid";
  const name = periodName(page.period, policy);
  return (
    <section aria-label={t("summary")} className="flex flex-col gap-1.5 rounded-2xl bg-surface p-3">
      <p className="text-sm text-muted">
        {name.kind === "month"
          ? t(paid ? "paidIn" : "spentIn", { month: common(`month.${name.month as 1}`) })
          : t(paid ? "paidBetween" : "spentBetween", {
              start: formatDate(name.start, formats),
              end: formatDate(name.end, formats),
            })}
      </p>
      <p className="text-[clamp(1.75rem,8.5vw,2rem)] leading-tight font-semibold [overflow-wrap:anywhere] text-ink">
        {money(paid ? unified.paid : unified.consumed)}
      </p>
      {/* An API without the per-space figures (bySpace) has no "what she paid": her share alone, as before. */}
      {unified.bySpace.length > 0 ? (
        <div
          role="group"
          aria-label={t("mode.label")}
          className="grid grid-cols-2 gap-1 rounded-full bg-bg p-1"
        >
          {(["share", "paid"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
              className={`min-h-11 rounded-full px-3 text-sm ${
                mode === option ? "bg-surface font-semibold text-ink" : "font-medium text-muted"
              }`}
            >
              {t(`mode.${option}`)}
            </button>
          ))}
        </div>
      ) : null}
      {unified.bySpace.length > 0 ? (
        <ul aria-label={t("bySpace")} className="flex flex-col divide-y divide-line rounded-xl bg-bg px-3">
          {unified.bySpace.map((space) => (
            <li key={space.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              {space.kind === "PERSONAL" ? (
                <span className="min-w-0 [overflow-wrap:anywhere] text-ink-2">{space.name}</span>
              ) : (
                <SpaceChip name={space.name} color={space.color} />
              )}
              <span className="shrink-0 font-semibold whitespace-nowrap text-ink">
                {money(paid ? space.paid : space.consumed)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-sm text-muted">{t("income", { amount: money(page.totals.income) })}</p>
      <Link
        href={unified.href}
        className="flex min-h-11 items-center self-start text-sm font-medium text-accent"
      >
        {t("byCategory")}
      </Link>
    </section>
  );
}
