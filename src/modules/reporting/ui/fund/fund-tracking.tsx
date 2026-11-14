import dynamic from "next/dynamic";
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { absolute } from "@/modules/balances/ui";
import { Badge, Icon } from "@/shared/ui";
import type { FundTrackingDto, MemberDto, MoneyDto, SpaceDto } from "@/shared/ui/api/dto";
import { formatDate, formatMoney, formatSignedMoney, type Formats } from "@/shared/ui/format/formatters";
import { periodName } from "@/shared/ui/time/period-name";
import { barWidth } from "../lines/bar";
import { activeFundRows } from "../matrix/idle-members";
import { memberName } from "../member-name";

const isNegative = (money: MoneyDto) => money.amount.startsWith("-");

// P328: the member's detail sheet loads only when someone opens it.
const MemberFundSheet = dynamic(
  () => import("./member-fund-sheet").then((module) => module.MemberFundSheet),
  {
    ssr: false,
  },
);

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
  space,
  formats,
}: {
  readonly fund: FundTrackingDto;
  readonly members: readonly MemberDto[];
  /** P328: the space whose fund this is, named in a member's detail ("Al fondo de Hogar"). */
  readonly space: Pick<SpaceDto, "name" | "periodPolicy">;
  readonly formats: Pick<Formats, "numberFormat" | "dateFormat">;
}) {
  const t = useTranslations("reports.fund");
  const tr = useTranslations("reports");
  const tc = useTranslations("common");
  const base = useId();
  const [detail, setDetail] = useState<string | null>(null);
  // P328: the sheet names a calendar month alone ("noviembre"), any other period by its dates.
  const named = periodName(fund.period, space.periodPolicy);
  const period =
    named.kind === "month"
      ? tc(`month.${named.month as 1}`)
      : tc("periodRange", { start: formatDate(named.start, formats), end: formatDate(named.end, formats) });
  const shown = detail === null ? undefined : fund.members.find((row) => row.memberId === detail);
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
                {/* P328: tapping the member opens what they have to put in and what they paid directly. */}
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-label={t("detail.open", { name: memberName(members, row.memberId, tr) })}
                  onClick={() => setDetail(row.memberId)}
                  className="flex min-h-11 flex-wrap items-center justify-between gap-2 text-left"
                >
                  <span
                    id={nameId}
                    className="flex min-w-0 items-center gap-1 text-base font-semibold [overflow-wrap:anywhere]"
                  >
                    {memberName(members, row.memberId, tr)}
                    <Icon name="chevronRight" size={18} className="shrink-0 text-muted" />
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
                </button>
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
      {shown ? (
        <MemberFundSheet
          open={detail !== null}
          onOpenChange={(open) => setDetail(open ? detail : null)}
          row={shown}
          name={memberName(members, shown.memberId, tr)}
          period={period}
          spaceName={space.name}
          total={fund.totals.expected}
          formats={formats}
        />
      ) : null}
    </>
  );
}
