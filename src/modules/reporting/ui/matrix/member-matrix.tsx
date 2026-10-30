import { useId, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { absolute } from "@/modules/balances/ui";
import { Badge, Icon, VisuallyHidden } from "@/shared/ui";
import type { MemberDto, MemberMatrixDto, MoneyDto, SpaceDto } from "@/shared/ui/api/dto";
import { formatMoney, formatSignedMoney, type Formats } from "@/shared/ui/format/formatters";
import type { UiIconName } from "@/shared/ui/icons/ui-icons";
import { memberName } from "../member-name";
import { viewHref } from "../views";
import { withoutIdleMembers } from "./idle-members";

type MatrixLine = MemberMatrixDto["lines"][number];
type MatrixCell = MatrixLine["members"][number];
type Status = NonNullable<MatrixCell["status"]>;
type MemberTotal = NonNullable<MemberMatrixDto["members"]>[number];
export type MatrixColumn = "assigned" | "contributed" | "consumed" | "gap";

const COLUMNS: readonly MatrixColumn[] = ["assigned", "contributed", "consumed", "gap"];

// The status badge says it in words and in an arrow, so the gap never relies on color alone.
export const MATRIX_STATUS: Record<Status, { tone: "accent" | "owe" | "neutral"; icon?: UiIconName }> = {
  OVER_CONTRIBUTED: { tone: "accent", icon: "arrowUp" },
  UNDER_CONTRIBUTED: { tone: "owe", icon: "arrowDown" },
  ON_TARGET: { tone: "neutral" },
};

// Under 640 px a line's row is a card (the line, then one labelled figure per line), because four figures and a
// badge side by side do not fit a phone; from 640 px it is a table row inside a region that scrolls on its own.
const CELL =
  "flex justify-between gap-3 py-0.5 text-right tabular-nums before:text-left before:text-muted before:content-[attr(data-label)] sm:table-cell sm:py-2.5 sm:pl-3 sm:before:hidden";

type ReportsT = ReturnType<typeof useTranslations<"reports">>;

/**
 * Why a figure is missing: the savings note for a savings line's consumption (no reason explains that one), else the
 * line's own reason, else nothing is known. The Members view and the desktop overview say it alike (ruling P217).
 */
export const missingReason = (
  line: Pick<MatrixLine, "funding" | "reason">,
  column: MatrixColumn,
  t: ReportsT,
): string =>
  column === "consumed" && line.funding === "SAVINGS"
    ? t("matrix.savingsNote")
    : line.reason
      ? t(`reason.${line.reason}`)
      : t("matrix.noFigure");

/**
 * HU-E9-10 (the Matrix artboard), #213 (ruling P262): one row per member first, with their total gap in words, and
 * under it, on tap, that member's assigned, contributed and consumed figures and gap per line of the period's plan.
 * Every figure is the API's, the total too (ruling P201). A missing one is a dash for the eye and its reason in words
 * for assistive technology; each reason is also written once under the member's table (ruling P217). A member with
 * nothing in the period has no row (#213, #217).
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
  const { lines } = withoutIdleMembers(matrix);
  // Every line lists the same members in join order, so the first one names who keeps a row.
  const active = lines[0]?.members.map((cell) => cell.memberId) ?? [];
  const fundHref = viewHref(space, "fund", matrix.period.label);
  return (
    <>
      {active.map((memberId) => (
        <MemberSection
          key={memberId}
          memberId={memberId}
          name={memberName(members, memberId, t)}
          total={matrix.members?.find((total) => total.memberId === memberId) ?? null}
          lines={lines}
          fundHref={fundHref}
          formats={formats}
        />
      ))}
    </>
  );
}

/** #213: a member's total gap as a sentence, "Le faltan $ 482.000", so its direction is never a sign or a color. */
function TotalGap({
  total,
  formats,
}: {
  readonly total: MemberTotal | null;
  readonly formats: Pick<Formats, "numberFormat">;
}) {
  const t = useTranslations("reports.matrix.total");
  if (total === null || total.gap === null || total.status === null) {
    return <p className="text-sm text-muted">{t("none")}</p>;
  }
  const { tone, icon } = MATRIX_STATUS[total.status];
  return (
    <p
      data-total={total.status}
      className={`flex items-center gap-1 font-semibold tabular-nums ${tone === "owe" ? "text-owe-ink" : "text-ink"}`}
    >
      {icon ? <Icon name={icon} size={18} /> : null}
      {t(total.status, { amount: formatMoney(absolute(total.gap), formats) })}
    </p>
  );
}

function MemberSection({
  memberId,
  name,
  total,
  lines,
  fundHref,
  formats,
}: {
  readonly memberId: string;
  readonly name: string;
  readonly total: MemberTotal | null;
  readonly lines: readonly MatrixLine[];
  readonly fundHref: string;
  readonly formats: Pick<Formats, "numberFormat">;
}) {
  const t = useTranslations("reports");
  const heading = useId();
  const detail = useId();
  const [open, setOpen] = useState(false);
  return (
    <section
      aria-labelledby={heading}
      data-member={memberId}
      className="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={heading} className="text-base font-semibold text-ink [overflow-wrap:anywhere]">
          {name}
        </h2>
        <TotalGap total={total} formats={formats} />
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detail}
        onClick={() => setOpen((shown) => !shown)}
        className="flex min-h-11 items-center gap-1 self-start rounded-lg px-1 text-sm font-medium text-accent"
      >
        {t(open ? "matrix.hideDetail" : "matrix.showDetail")}{" "}
        <VisuallyHidden>{t("matrix.detailOf", { member: name })}</VisuallyHidden>
        <Icon
          name="chevronDown"
          size={18}
          className={open ? "rotate-180 transition-transform" : "transition-transform"}
        />
      </button>
      <div id={detail} hidden={!open} className="flex flex-col gap-2">
        <MemberDetail memberId={memberId} name={name} lines={lines} fundHref={fundHref} formats={formats} />
      </div>
    </section>
  );
}

function MemberDetail({
  memberId,
  name,
  lines,
  fundHref,
  formats,
}: {
  readonly memberId: string;
  readonly name: string;
  readonly lines: readonly MatrixLine[];
  readonly fundHref: string;
  readonly formats: Pick<Formats, "numberFormat">;
}) {
  const t = useTranslations("reports");
  const tb = useTranslations("budgeting");
  const caption = t("matrix.memberCaption", { member: name });
  const reasons = [...new Set(lines.flatMap((line) => (line.reason ? [line.reason] : [])))];
  const savings = lines.some((line) => line.funding === "SAVINGS");
  return (
    <>
      <div role="region" aria-label={caption} tabIndex={0} className="relative overflow-x-auto">
        <table className="block w-full text-sm sm:table">
          <caption className="block pb-1 text-left text-sm text-muted sm:table-caption">{caption}</caption>
          <thead className="sr-only sm:not-sr-only sm:table-header-group">
            <tr className="sm:border-b sm:border-line">
              <th scope="col" className="py-2 text-left font-medium text-muted">
                {t("matrix.line")}
              </th>
              {COLUMNS.map((column) => (
                <th key={column} scope="col" className="py-2 pl-3 text-right font-medium text-muted">
                  {t(`matrix.${column}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="block sm:table-row-group [&>tr:last-child]:border-b-0">
            {lines.map((line) => {
              const cell = line.members.find((c) => c.memberId === memberId);
              return cell ? (
                <LineRow
                  key={line.lineId}
                  line={line}
                  cell={cell}
                  kind={t("matrix.kind", {
                    funding: tb(`funding.${line.funding}`),
                    rule: tb(`rule.${line.rule}`),
                  })}
                  formats={formats}
                />
              ) : null;
            })}
          </tbody>
        </table>
      </div>
      {reasons.map((reason) => (
        <p key={reason} className="text-sm text-muted">
          {t(`reason.${reason}`)}
        </p>
      ))}
      {savings ? <p className="text-sm text-muted">{t("matrix.savingsNote")}</p> : null}
      {reasons.includes("TRACKED_AT_FUND_LEVEL") ? (
        <Link
          href={fundHref}
          className="inline-flex min-h-11 items-center self-start font-semibold underline"
        >
          {t("matrix.toFund")}
        </Link>
      ) : null}
    </>
  );
}

function LineRow({
  line,
  cell,
  kind,
  formats,
}: {
  readonly line: MatrixLine;
  readonly cell: MatrixCell;
  readonly kind: string;
  readonly formats: Pick<Formats, "numberFormat">;
}) {
  const t = useTranslations("reports");
  const figure = (column: MatrixColumn) => {
    const value: MoneyDto | null = cell[column];
    return value ? (
      formatMoney(value, formats)
    ) : (
      <>
        <span aria-hidden="true">—</span>
        <VisuallyHidden>{missingReason(line, column, t)}</VisuallyHidden>
      </>
    );
  };
  const badge = cell.status ? { status: cell.status, ...MATRIX_STATUS[cell.status] } : null;
  return (
    <tr data-line={line.lineId} className="flex flex-col border-b border-line py-3 sm:table-row sm:py-0">
      <th scope="row" className="pb-1 text-left font-normal sm:table-cell sm:py-2.5 sm:pr-3">
        <span className="block font-semibold text-ink [overflow-wrap:anywhere]">{line.name}</span>
        <span className="block text-xs text-muted">{kind}</span>
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
}
