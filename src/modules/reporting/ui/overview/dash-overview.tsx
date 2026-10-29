import { useId, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, VisuallyHidden } from "@/shared/ui";
import type { MemberMatrixDto, MoneyDto, SpaceDto, SpaceMemberDto } from "@/shared/ui/api/dto";
import { formatMoney, formatPercent, formatSignedMoney, type Formats } from "@/shared/ui/format/formatters";
import { NodeLabel } from "../by-group/node-label";
import { treeOf } from "../by-group/spending-tree";
import { barWidth } from "../lines/bar";
import { MATRIX_STATUS, missingReason, type MatrixColumn } from "../matrix/member-matrix";
import { memberName } from "../member-name";
import { ChangeText } from "../trend/change-text";
import { viewHref } from "../views";
import type { Overview } from "./overview";

type Money = Pick<Formats, "numberFormat">;

const PANEL = "flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-surface p-3";
const LINK = "inline-flex min-h-11 items-center self-start font-semibold underline";
const HEAD = "py-2 pl-3 text-right font-medium text-muted first:pl-0";
const FIGURE = "py-2 pl-3 text-right whitespace-nowrap tabular-nums";

const isNegative = (money: MoneyDto) => money.amount.startsWith("-");

/** A panel labelled by its own heading, so each one is a region a screen reader can jump to. */
function Panel({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className={PANEL}>
      <h2 id={heading} className="text-lg font-semibold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * HU-E9-10 (the DashDesktop artboard, ruling P216): from 1024 px a shared space's Lines view is followed by every
 * other dashboard at once: by group (its top level), the fund contributions, the change against the previous period
 * and one member-by-line table. Under 1024 px the panels are not rendered visible and the view tabs lead to each view.
 * A panel whose read failed is left out. Every figure is the API's (ruling P201); bars are presentation only (ruling
 * P202), and no chart is drawn, so the route ships no Recharts.
 */
export function DashOverview({
  space,
  overview,
  formats,
}: {
  readonly space: Pick<SpaceDto, "id" | "kind">;
  readonly overview: Overview;
  readonly formats: Money;
}) {
  const { matrix, fund, groups, trend, members } = overview;
  const showsTrend = trend !== null && trend.plan !== null;
  const showsMatrix = matrix !== null && matrix.plan !== null;
  if (!groups && !fund && !showsTrend && !showsMatrix) return null;
  return (
    <div className="hidden gap-3 lg:grid lg:grid-cols-[repeat(auto-fit,minmax(min(480px,100%),1fr))] lg:items-start">
      {groups ? <GroupsPanel space={space} groups={groups} formats={formats} /> : null}
      {fund ? <FundPanel fund={fund} members={members} formats={formats} /> : null}
      {showsTrend ? <TrendPanel space={space} trend={trend} formats={formats} /> : null}
      {showsMatrix ? <MatrixPanel matrix={matrix} members={members} formats={formats} /> : null}
    </div>
  );
}

function GroupsPanel({
  space,
  groups,
  formats,
}: {
  readonly space: Pick<SpaceDto, "id" | "kind">;
  readonly groups: NonNullable<Overview["groups"]>;
  readonly formats: Money;
}) {
  const t = useTranslations("reports");
  return (
    <Panel title={t("view.groups")}>
      <ul aria-label={t("byGroup.groups")} className="flex flex-col divide-y divide-line">
        {treeOf(groups.groups).map((row) => (
          <li key={row.id} className="flex flex-col gap-2 py-2.5">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
              <span className="min-w-0 flex-[1_1_8rem] font-semibold [overflow-wrap:anywhere]">
                <NodeLabel name={row.name} />
              </span>
              {row.archived ? <Badge>{t("byGroup.archived")}</Badge> : null}
              <span className="ml-auto font-semibold">{formatMoney(row.total, formats)}</span>
              <span className="w-16 text-right text-sm text-muted">{formatPercent(row.share, formats)}</span>
            </span>
            <span aria-hidden="true" className="block h-2 w-full overflow-hidden rounded-full bg-track">
              <span
                data-bar
                className="block h-full rounded-full bg-accent"
                style={{ width: `${Number(row.share)}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
      <Link href={viewHref(space, "groups", groups.period.label)} className={LINK}>
        {t("overview.toGroups")}
      </Link>
    </Panel>
  );
}

function FundPanel({
  fund,
  members,
  formats,
}: {
  readonly fund: NonNullable<Overview["fund"]>;
  readonly members: readonly SpaceMemberDto[];
  readonly formats: Money;
}) {
  const t = useTranslations("reports");
  const money = (value: MoneyDto) => formatMoney(value, formats);
  return (
    <Panel title={t("fund.title")}>
      <p className="text-sm text-muted tabular-nums">
        {t("overview.fundSummary", {
          actual: money(fund.totals.actual),
          expected: money(fund.totals.expected),
        })}
      </p>
      <table className="w-full text-sm">
        <caption>
          <VisuallyHidden>{t("fund.byMember")}</VisuallyHidden>
        </caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="py-2 text-left font-medium text-muted">
              {t("matrix.member")}
            </th>
            <th scope="col" className={HEAD}>
              {t("fund.expected")}
            </th>
            <th scope="col" className={HEAD}>
              {t("fund.actual")}
            </th>
            <th scope="col" className={HEAD}>
              {t("fund.difference")}
            </th>
          </tr>
        </thead>
        <tbody>
          {fund.members.map((row) => (
            <tr key={row.memberId} className="border-b border-line last:border-b-0">
              <th scope="row" className="py-2 text-left font-semibold text-ink [overflow-wrap:anywhere]">
                {memberName(members, row.memberId, t)}
                <span
                  aria-hidden="true"
                  className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-track"
                >
                  <span
                    data-bar
                    className={`block h-full rounded-full ${isNegative(row.difference) ? "bg-owe" : "bg-accent"}`}
                    style={{ width: `${barWidth(row.actual, row.expected)}%` }}
                  />
                </span>
              </th>
              <td className={FIGURE}>{money(row.expected)}</td>
              <td className={FIGURE}>{money(row.actual)}</td>
              <td
                className={`${FIGURE} font-semibold ${isNegative(row.difference) ? "text-owe-ink" : "text-ink"}`}
              >
                {formatSignedMoney(row.difference, formats)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function TrendPanel({
  space,
  trend,
  formats,
}: {
  readonly space: Pick<SpaceDto, "id" | "kind">;
  readonly trend: NonNullable<Overview["trend"]>;
  readonly formats: Money;
}) {
  const t = useTranslations("reports");
  const ids = useId();
  return (
    <Panel title={t("overview.againstPrevious")}>
      <ul className="flex flex-col divide-y divide-line">
        {trend.lines.map((line) => {
          const last = line.points.at(-1);
          const nameId = `${ids}-${line.lineId}`;
          return (
            <li
              key={line.lineId}
              aria-labelledby={nameId}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5"
            >
              <span id={nameId} className="font-medium text-ink [overflow-wrap:anywhere]">
                {line.name}
              </span>
              {last ? (
                <span className="text-sm text-ink">
                  <ChangeText
                    change={last.change}
                    changePercent={last.changePercent}
                    changeStatus={last.changeStatus}
                    formats={formats}
                  />
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Link href={viewHref(space, "trend", trend.periods.at(-1)?.label)} className={LINK}>
        {t("overview.toTrend")}
      </Link>
    </Panel>
  );
}

const MATRIX_COLUMNS: readonly MatrixColumn[] = ["assigned", "contributed", "consumed", "gap"];

function MatrixPanel({
  matrix,
  members,
  formats,
}: {
  readonly matrix: MemberMatrixDto;
  readonly members: readonly SpaceMemberDto[];
  readonly formats: Money;
}) {
  const t = useTranslations("reports");
  const title = t("overview.matrixTitle");
  return (
    <div className={`${PANEL} lg:col-span-full`}>
      <div role="region" aria-label={title} tabIndex={0} className="relative overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="pb-2 text-left text-lg font-semibold text-ink">{title}</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="py-2 text-left font-medium text-muted">
                {t("lines.line")}
              </th>
              <th scope="col" className="py-2 pl-3 text-left font-medium text-muted">
                {t("matrix.member")}
              </th>
              {MATRIX_COLUMNS.map((column) => (
                <th key={column} scope="col" className={HEAD}>
                  {t(`matrix.${column}`)}
                </th>
              ))}
            </tr>
          </thead>
          {matrix.lines.map((line) => (
            <tbody key={line.lineId} data-line={line.lineId} className="border-b border-line last:border-b-0">
              {line.members.map((cell, index) => {
                const figure = (column: MatrixColumn) => {
                  const value = cell[column];
                  return value ? (
                    formatMoney(value, formats)
                  ) : (
                    <>
                      <span aria-hidden="true">—</span>
                      <VisuallyHidden>{missingReason(line, column, t)}</VisuallyHidden>
                    </>
                  );
                };
                const status = cell.status ? MATRIX_STATUS[cell.status] : null;
                return (
                  <tr key={cell.memberId}>
                    {index === 0 ? (
                      <th
                        scope="rowgroup"
                        rowSpan={line.members.length}
                        className="py-2 pr-3 text-left align-top font-semibold text-ink [overflow-wrap:anywhere]"
                      >
                        {line.name}
                      </th>
                    ) : null}
                    <th
                      scope="row"
                      className="py-2 pl-3 text-left font-normal text-ink [overflow-wrap:anywhere]"
                    >
                      {memberName(members, cell.memberId, t)}
                    </th>
                    <td className={FIGURE}>{figure("assigned")}</td>
                    <td className={FIGURE}>{figure("contributed")}</td>
                    <td className={FIGURE}>{figure("consumed")}</td>
                    <td className={FIGURE}>
                      {cell.gap ? (
                        <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
                          <span
                            className={`font-semibold ${cell.status === "UNDER_CONTRIBUTED" ? "text-owe-ink" : "text-ink"}`}
                          >
                            {formatSignedMoney(cell.gap, formats)}
                          </span>
                          {cell.status && status ? (
                            <Badge tone={status.tone} icon={status.icon}>
                              {t(`status.${cell.status}`)}
                            </Badge>
                          ) : null}
                        </span>
                      ) : (
                        figure("gap")
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
      <p className="text-sm text-muted">{t("overview.matrixNote")}</p>
    </div>
  );
}
