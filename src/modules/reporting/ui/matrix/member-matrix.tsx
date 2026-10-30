import { useId } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, VisuallyHidden } from "@/shared/ui";
import type { MemberDto, MemberMatrixDto, MoneyDto, SpaceDto } from "@/shared/ui/api/dto";
import { formatMoney, formatSignedMoney, type Formats } from "@/shared/ui/format/formatters";
import type { UiIconName } from "@/shared/ui/icons/ui-icons";
import { memberName } from "../member-name";
import { viewHref } from "../views";
import { withoutIdleMembers } from "./idle-members";

type MatrixLine = MemberMatrixDto["lines"][number];
type Status = NonNullable<MatrixLine["members"][number]["status"]>;
export type MatrixColumn = "assigned" | "contributed" | "consumed" | "gap";

const COLUMNS: readonly MatrixColumn[] = ["assigned", "contributed", "consumed", "gap"];

// The status badge says it in words and in an arrow, so the gap never relies on color alone.
export const MATRIX_STATUS: Record<Status, { tone: "accent" | "owe" | "neutral"; icon?: UiIconName }> = {
  OVER_CONTRIBUTED: { tone: "accent", icon: "arrowUp" },
  UNDER_CONTRIBUTED: { tone: "owe", icon: "arrowDown" },
  ON_TARGET: { tone: "neutral" },
};

// Under 640 px a member's row is a card (the name, then one labelled figure per line), because four figures and a
// badge side by side do not fit a phone; from 640 px it is a table row inside a region that scrolls on its own.
const CELL =
  "flex justify-between gap-3 py-0.5 text-right tabular-nums before:text-left before:text-muted before:content-[attr(data-label)] sm:table-cell sm:py-2.5 sm:pl-3 sm:before:hidden";

/**
 * Why a figure is missing: the savings note for a savings line's consumption (no reason explains that one), else the
 * line's own reason, else nothing is known. The Members view and the desktop overview say it alike (ruling P217).
 */
export const missingReason = (
  line: Pick<MatrixLine, "funding" | "reason">,
  column: MatrixColumn,
  t: ReturnType<typeof useTranslations<"reports">>,
): string =>
  column === "consumed" && line.funding === "SAVINGS"
    ? t("matrix.savingsNote")
    : line.reason
      ? t(`reason.${line.reason}`)
      : t("matrix.noFigure");

/**
 * HU-E9-10 (the Matrix artboard): one table per line of the period's plan, with each member's assigned, contributed
 * and consumed figures and the gap with its status. Every figure is the API's (ruling P201). A missing one is a dash
 * for the eye and its reason in words for assistive technology; the reason is also written once under the table
 * (ruling P217). A member with nothing in the period has no row (#213, #217).
 */
export function MemberMatrix({
  space,
  matrix,
  members,
  formats,
}: {
  /** The link from a fund-level line to the Fund view needs the space. */
  readonly space: Pick<SpaceDto, "id" | "kind">;
  readonly matrix: MemberMatrixDto;
  readonly members: readonly Pick<MemberDto, "id" | "displayName">[];
  readonly formats: Pick<Formats, "numberFormat">;
}) {
  const t = useTranslations("reports");
  if (matrix.plan === null) return <p className="text-sm text-muted">{t("matrix.noPlan")}</p>;
  return (
    <>
      {withoutIdleMembers(matrix).lines.map((line) => (
        <MatrixLineSection
          key={line.lineId}
          line={line}
          fundHref={viewHref(space, "fund", matrix.period.label)}
          members={members}
          formats={formats}
        />
      ))}
    </>
  );
}

function MatrixLineSection({
  line,
  fundHref,
  members,
  formats,
}: {
  readonly line: MatrixLine;
  readonly fundHref: string;
  readonly members: readonly Pick<MemberDto, "id" | "displayName">[];
  readonly formats: Pick<Formats, "numberFormat">;
}) {
  const t = useTranslations("reports");
  const tb = useTranslations("budgeting");
  const heading = useId();
  const caption = t("matrix.caption", { line: line.name });
  const savings = line.funding === "SAVINGS";
  const money = (value: MoneyDto) => formatMoney(value, formats);

  const why = (column: MatrixColumn) => missingReason(line, column, t);

  return (
    <section
      aria-labelledby={heading}
      data-line={line.lineId}
      className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id={heading} className="text-base font-semibold text-ink [overflow-wrap:anywhere]">
          {line.name}
        </h2>
        <p className="text-sm text-muted">
          {t("matrix.kind", { funding: tb(`funding.${line.funding}`), rule: tb(`rule.${line.rule}`) })}
        </p>
      </div>
      <div role="region" aria-label={caption} tabIndex={0} className="relative overflow-x-auto">
        <table className="block w-full text-sm sm:table">
          <caption className="block pb-1 text-left text-sm text-muted sm:table-caption">{caption}</caption>
          <thead className="sr-only sm:not-sr-only sm:table-header-group">
            <tr className="sm:border-b sm:border-line">
              <th scope="col" className="py-2 text-left font-medium text-muted">
                {t("matrix.member")}
              </th>
              {COLUMNS.map((column) => (
                <th key={column} scope="col" className="py-2 pl-3 text-right font-medium text-muted">
                  {t(`matrix.${column}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="block sm:table-row-group [&>tr:last-child]:border-b-0">
            {line.members.map((cell) => {
              const figure = (column: MatrixColumn) => {
                const value = cell[column];
                return value ? (
                  money(value)
                ) : (
                  <>
                    <span aria-hidden="true">—</span>
                    <VisuallyHidden>{why(column)}</VisuallyHidden>
                  </>
                );
              };
              const badge = cell.status ? { status: cell.status, ...MATRIX_STATUS[cell.status] } : null;
              return (
                <tr
                  key={cell.memberId}
                  className="flex flex-col border-b border-line py-3 sm:table-row sm:py-0"
                >
                  <th
                    scope="row"
                    className="pb-1 text-left font-semibold text-ink [overflow-wrap:anywhere] sm:table-cell sm:py-2.5 sm:pr-3"
                  >
                    {memberName(members, cell.memberId, t)}
                  </th>
                  <td data-label={t("matrix.assigned")} className={CELL}>
                    {figure("assigned")}
                  </td>
                  <td data-label={t("matrix.contributed")} className={CELL}>
                    {figure("contributed")}
                  </td>
                  <td data-label={t("matrix.consumed")} className={CELL}>
                    {figure("consumed")}
                  </td>
                  <td data-label={t("matrix.gap")} className={CELL}>
                    {cell.gap ? (
                      <span className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
                        <span
                          className={`font-semibold ${cell.status === "UNDER_CONTRIBUTED" ? "text-owe-ink" : "text-ink"}`}
                        >
                          {formatSignedMoney(cell.gap, formats)}
                        </span>
                        {badge ? (
                          <>
                            {" "}
                            <Badge tone={badge.tone} icon={badge.icon}>
                              {t(`status.${badge.status}`)}
                            </Badge>
                          </>
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
        </table>
      </div>
      {line.reason ? <p className="text-sm text-muted">{t(`reason.${line.reason}`)}</p> : null}
      {savings ? <p className="text-sm text-muted">{t("matrix.savingsNote")}</p> : null}
      {line.reason === "TRACKED_AT_FUND_LEVEL" ? (
        <Link
          href={fundHref}
          className="inline-flex min-h-11 items-center self-start font-semibold underline"
        >
          {t("matrix.toFund")}
        </Link>
      ) : null}
    </section>
  );
}
