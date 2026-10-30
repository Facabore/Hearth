import { useId } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/shared/ui";
import type { FundTrackingDto, MemberDto, MoneyDto } from "@/shared/ui/api/dto";
import { formatMoney, formatSignedMoney, type Formats } from "@/shared/ui/format/formatters";
import { barWidth } from "../lines/bar";
import { activeFundRows } from "../matrix/idle-members";
import { memberName } from "../member-name";

const isNegative = (money: MoneyDto) => money.amount.startsWith("-");

// The owe ink, never `text-owe`: the plain owe color fails AA contrast below 18.66 px and these figures are small.
const FIGURE = "text-base font-semibold [overflow-wrap:anywhere]";

/**
 * HU-E9-10 (the Fund artboard): the API's totals of what is expected, contributed and still missing (ruling P201),
 * then a card per member with the same three figures, a badge and a bar. The card is the bar's text, so the chart
 * and the table are one element (ruling P202). An amount still owed carries its sign, its badge and its icon, so
 * the color is never the only signal. A member expected nothing who paid nothing in has no card (#217).
 */
export function FundTracking({
  fund,
  members,
  formats,
}: {
  readonly fund: FundTrackingDto;
  readonly members: readonly MemberDto[];
  readonly formats: Pick<Formats, "numberFormat">;
}) {
  const t = useTranslations("reports.fund");
  const tr = useTranslations("reports");
  const base = useId();
  const money = (value: MoneyDto) => formatMoney(value, formats);
  const owed = (value: MoneyDto) => (isNegative(value) ? " text-owe-ink" : "");
  const pairs = (figures: { expected: MoneyDto; actual: MoneyDto; difference: MoneyDto }) => (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2 tabular-nums">
      <div className="flex min-w-0 flex-col">
        <dt className="text-sm text-muted">{t("expected")}</dt>
        <dd className={FIGURE}>{money(figures.expected)}</dd>
      </div>
      <div className="flex min-w-0 flex-col">
        <dt className="text-sm text-muted">{t("actual")}</dt>
        <dd className={FIGURE}>{money(figures.actual)}</dd>
      </div>
      <div className="flex min-w-0 flex-col">
        <dt className="text-sm text-muted">{t("difference")}</dt>
        <dd data-field="difference" className={FIGURE + owed(figures.difference)}>
          {formatSignedMoney(figures.difference, formats)}
        </dd>
      </div>
    </dl>
  );
  return (
    <>
      <section
        aria-labelledby={`${base}-title`}
        className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3.5"
      >
        <h2 id={`${base}-title`} className="sr-only">
          {t("title")}
        </h2>
        {pairs(fund.totals)}
      </section>
      {fund.plan ? null : <p className="text-sm text-muted">{t("noPlan")}</p>}
      <section className="flex flex-col gap-2">
        <h2 id={`${base}-members`} className="text-lg font-semibold">
          {t("byMember")}
        </h2>
        <ul aria-labelledby={`${base}-members`} className="flex flex-col gap-2">
          {activeFundRows(fund.members).map((row) => {
            const nameId = `${base}-name-${row.memberId}`;
            const upToDate = !isNegative(row.difference);
            return (
              <li
                key={row.memberId}
                data-member={row.memberId}
                aria-labelledby={nameId}
                className="flex flex-col gap-2.5 rounded-2xl border border-line bg-surface p-3.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span id={nameId} className="min-w-0 text-base font-semibold [overflow-wrap:anywhere]">
                    {memberName(members, row.memberId, tr)}
                  </span>
                  {upToDate ? (
                    <Badge tone="accent" icon="check">
                      {t("upToDate")}
                    </Badge>
                  ) : (
                    <Badge tone="owe" icon="arrowDown">
                      {t("behind")}
                    </Badge>
                  )}
                </div>
                <span aria-hidden="true" className="block h-2 w-full overflow-hidden rounded-full bg-track">
                  <span
                    data-bar
                    className={`block h-full rounded-full ${upToDate ? "bg-accent" : "bg-owe"}`}
                    style={{ width: `${barWidth(row.actual, row.expected)}%` }}
                  />
                </span>
                {pairs(row)}
              </li>
            );
          })}
        </ul>
      </section>
      <p className="text-sm text-muted">{t("note")}</p>
    </>
  );
}
