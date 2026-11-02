import { useId } from "react";
import { useTranslations } from "next-intl";
import { absolute } from "@/modules/balances/ui";
import { Badge } from "@/shared/ui";
import type { FundTrackingDto, MemberDto, MoneyDto } from "@/shared/ui/api/dto";
import { formatMoney, formatSignedMoney, type Formats } from "@/shared/ui/format/formatters";
import { barWidth } from "../lines/bar";
import { activeFundRows } from "../matrix/idle-members";
import { memberName } from "../member-name";

const isNegative = (money: MoneyDto) => money.amount.startsWith("-");

// The owe ink, never `text-owe`: the plain owe color fails AA contrast below 18.66 px and these figures are small.
const FIGURE = "text-base font-semibold tabular-nums [overflow-wrap:anywhere]";
const TILE = "flex min-w-0 flex-col rounded-xl border px-3 py-2.5";

/**
 * HU-E9-10 (the Fund artboard, board E9-10 04 under ruling P272): the API's totals of what is expected, contributed
 * and still missing (ruling P201) as three tiles, the missing one tinted and named "Falta"; then one card per member
 * with a badge, a bar and the same three figures on one row. The card is the bar's text, so the chart and the table
 * are one element (ruling P202). An amount still owed carries its sign or its word, its badge and its icon, so the
 * color is never the only signal. A member expected nothing who paid nothing in has no card (#217).
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
  const short = isNegative(fund.totals.difference);
  return (
    <>
      <section aria-labelledby={`${base}-title`}>
        <h2 id={`${base}-title`} className="sr-only">
          {t("title")}
        </h2>
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2">
          <div className={`${TILE} border-line bg-surface`}>
            <dt className="text-sm text-muted">{t("expected")}</dt>
            <dd className={FIGURE}>{money(fund.totals.expected)}</dd>
          </div>
          <div className={`${TILE} border-line bg-surface`}>
            <dt className="text-sm text-muted">{t("actual")}</dt>
            <dd className={FIGURE}>{money(fund.totals.actual)}</dd>
          </div>
          {/* "Falta" says the direction in a word, so the amount is written without its sign. */}
          <div className={`${TILE} ${short ? "border-transparent bg-owe-soft" : "border-line bg-surface"}`}>
            <dt className={`text-sm ${short ? "text-owe-ink" : "text-muted"}`}>
              {t(short ? "missing" : "difference")}
            </dt>
            <dd data-field="difference" className={FIGURE + (short ? " text-owe-ink" : "")}>
              {short
                ? money(absolute(fund.totals.difference))
                : formatSignedMoney(fund.totals.difference, formats)}
            </dd>
          </div>
        </dl>
      </section>
      {fund.plan ? null : <p className="text-sm text-muted">{t("noPlan")}</p>}
      <section className="flex flex-col gap-2">
        <h2 id={`${base}-members`} className="text-base font-semibold">
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span id={nameId} className="min-w-0 text-base font-semibold [overflow-wrap:anywhere]">
                    {memberName(members, row.memberId, tr)}
                  </span>
                  {upToDate ? (
                    <Badge tone="accent" icon="check">
                      {t("upToDate")}
                    </Badge>
                  ) : (
                    <Badge tone="owe" icon="arrowDown">
                      {t("behindBy", { amount: money(absolute(row.difference)) })}
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
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <div className="flex min-w-0 flex-col">
                    <dt className="text-muted">{t("expected")}</dt>
                    <dd className="font-medium tabular-nums [overflow-wrap:anywhere]">
                      {money(row.expected)}
                    </dd>
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <dt className="text-muted">{t("actual")}</dt>
                    <dd className="font-medium tabular-nums [overflow-wrap:anywhere]">{money(row.actual)}</dd>
                  </div>
                  <div className="flex min-w-0 flex-col text-right">
                    <dt className="text-muted">{t("difference")}</dt>
                    <dd
                      data-field="difference"
                      className={`font-semibold tabular-nums [overflow-wrap:anywhere]${
                        isNegative(row.difference) ? " text-owe-ink" : ""
                      }`}
                    >
                      {formatSignedMoney(row.difference, formats)}
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      </section>
      <p className="text-sm text-muted">{t("note")}</p>
    </>
  );
}
