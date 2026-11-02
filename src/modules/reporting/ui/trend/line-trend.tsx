import { useId } from "react";
import { useTranslations } from "next-intl";
import { VisuallyHidden } from "@/shared/ui";
import type { LineTrendDto, MoneyDto, SpaceDto } from "@/shared/ui/api/dto";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";
import { barWidth } from "../lines/bar";
import { ChangeBadge, changeFigure } from "./change-text";
import { useShortPeriod } from "./short-period";

type TrendLine = LineTrendDto["lines"][number];
type TrendPoint = TrendLine["points"][number];

/** A period where a line has no figure: a dash on screen, its name for a screen reader. */
function NoFigure({ text }: { readonly text: string }) {
  return (
    <>
      <span aria-hidden="true">—</span>
      <VisuallyHidden>{text}</VisuallyHidden>
    </>
  );
}

/** The larger of two amounts, to scale both bars of a comparison against it; presentation only (ruling P202). */
const larger = (a: MoneyDto, b: MoneyDto): MoneyDto => (BigInt(a.amount) >= BigInt(b.amount) ? a : b);

/**
 * HU-E9-11 (board E9-11 04 under ruling P272): each line of the end period's plan against the period before, one card
 * per line with where it went as a badge, what it spent and its change, and for a line that went up or down the two
 * periods as bars. Every figure is the API's (ruling P201); the bars are CSS widths, so the page loads no chart.
 */
export function LineTrend({
  space,
  trend,
  formats,
}: {
  readonly space: SpaceDto;
  readonly trend: LineTrendDto;
  readonly formats: Pick<Formats, "numberFormat" | "dateFormat">;
}) {
  const t = useTranslations("reports");
  const short = useShortPeriod();
  const ids = useId();
  if (trend.plan === null) return <p className="text-sm text-muted">{t("trend.noPlan")}</p>;
  const [before, end] = trend.periods.slice(-2).map((p) => short(p, space.periodPolicy, formats).month);
  const money = (value: MoneyDto | null) =>
    value ? formatMoney(value, formats) : <NoFigure text={t("trend.noFigure")} />;
  return (
    <section className="flex flex-col gap-3">
      <ul aria-label={t("trend.linesCaption")} className="flex flex-col gap-2">
        {trend.lines.map((line) => {
          const last = line.points.at(-1);
          const previous = line.points.at(-2);
          const nameId = `${ids}-${line.lineId}`;
          return (
            <li
              key={line.lineId}
              data-line={line.lineId}
              aria-labelledby={nameId}
              className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span id={nameId} className="min-w-0 font-semibold text-ink [overflow-wrap:anywhere]">
                  {line.name}
                </span>
                {last?.changeStatus ? (
                  <span data-status className="shrink-0">
                    <ChangeBadge changeStatus={last.changeStatus} />
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                <span className="text-muted">
                  {t("trend.spentIn", { period: end ?? "" })}{" "}
                  <span className="font-semibold text-ink tabular-nums">{money(last?.spent ?? null)}</span>
                </span>
                {last?.changeStatus === "NEW" ? (
                  <span className="font-semibold text-ink">{t("trend.noPrevious")}</span>
                ) : last?.changeStatus ? (
                  <span data-change className="font-semibold text-ink tabular-nums">
                    {changeFigure(last.change, last.changePercent, formats)}
                  </span>
                ) : null}
              </div>
              {last && previous ? (
                <Compare
                  previous={previous}
                  last={last}
                  names={[before ?? "", end ?? ""]}
                  formats={formats}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted">{t("trend.linesNote")}</p>
    </section>
  );
}

/**
 * Board E9-11 04: a line that went up or down draws its previous and its end period as two bars against the larger.
 * The previous figure is read too, never only drawn; an unchanged or new line draws none.
 */
function Compare({
  previous,
  last,
  names,
  formats,
}: {
  readonly previous: TrendPoint;
  readonly last: TrendPoint;
  readonly names: readonly [string, string];
  readonly formats: Pick<Formats, "numberFormat">;
}) {
  const t = useTranslations("reports.trend");
  if (last.changeStatus !== "INCREASED" && last.changeStatus !== "DECREASED") return null;
  if (!previous.spent || !last.spent) return null;
  const scale = larger(previous.spent, last.spent);
  return (
    <div data-compare className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-xs text-muted">
      {(
        [
          [names[0], previous.spent, "bg-accent opacity-40"],
          [names[1], last.spent, "bg-accent"],
        ] as const
      ).map(([name, spent, fill]) => (
        <div key={name} className="contents">
          <span data-period aria-hidden="true">
            {name}
          </span>
          <span aria-hidden="true" className="block h-1.5 w-full overflow-hidden rounded-full bg-track">
            <span
              data-bar
              className={`block h-full rounded-full ${fill}`}
              style={{ width: `${barWidth(spent, scale)}%` }}
            />
          </span>
        </div>
      ))}
      <VisuallyHidden>{`${t("spentIn", { period: names[0] })} ${formatMoney(previous.spent, formats)}`}</VisuallyHidden>
    </div>
  );
}
