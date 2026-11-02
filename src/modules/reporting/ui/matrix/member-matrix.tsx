import { useId, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { absolute } from "@/modules/balances/ui";
import { Icon, VisuallyHidden } from "@/shared/ui";
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

/** The figures a line's caption names, in the board's order; the gap sits at the line's right instead. */
const FIGURES = ["assigned", "contributed", "consumed"] as const;

// The status says it in words and in an arrow, so the gap never relies on color alone.
export const MATRIX_STATUS: Record<Status, { tone: "accent" | "owe" | "neutral"; icon?: UiIconName }> = {
  OVER_CONTRIBUTED: { tone: "accent", icon: "arrowUp" },
  UNDER_CONTRIBUTED: { tone: "owe", icon: "arrowDown" },
  ON_TARGET: { tone: "neutral" },
};

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
 * HU-E9-10 (the Matrix artboard, board E9-10 03 under ruling P272), #213 (ruling P262): one card with a row per
 * member, their initial, their total gap in words under their name and, on tap, their lines of the period's plan.
 * Every figure is the API's, the total too (ruling P201). A member with nothing in the period has no row (#213, #217).
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
    <div
      data-members
      className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface"
    >
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
    </div>
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
    return (
      <p data-total="none" className="text-sm text-muted">
        {t("none")}
      </p>
    );
  }
  const { tone, icon } = MATRIX_STATUS[total.status];
  const ink = tone === "owe" ? "text-owe-ink" : tone === "accent" ? "text-accent" : "text-ink";
  return (
    <p
      data-total={total.status}
      className={`flex items-center gap-1 text-sm font-semibold tabular-nums ${ink}`}
    >
      {icon ? <Icon name={icon} size={16} /> : null}
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
  const owes = total?.status === "UNDER_CONTRIBUTED";
  return (
    <section aria-labelledby={heading} data-member={memberId} className="flex flex-col">
      {/* The whole row opens the detail: the button's box covers it (its ::after), the chevron says so. */}
      <div className="relative flex items-center gap-3 px-3.5 py-3">
        <span
          aria-hidden="true"
          data-initial
          className={`flex size-10 shrink-0 items-center justify-center rounded-full text-base font-semibold ${
            owes ? "bg-owe-soft text-owe-ink" : "bg-accent-soft text-accent"
          }`}
        >
          {initialOf(name)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col items-start">
          <h2 id={heading} className="text-base font-semibold text-ink [overflow-wrap:anywhere]">
            {name}
          </h2>
          <TotalGap total={total} formats={formats} />
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detail}
            onClick={() => setOpen((shown) => !shown)}
            className="rounded-lg text-sm font-medium text-accent after:absolute after:inset-0 after:content-['']"
          >
            {t(open ? "matrix.hideDetail" : "matrix.showDetail")}{" "}
            <VisuallyHidden>{t("matrix.detailOf", { member: name })}</VisuallyHidden>
          </button>
        </div>
        <Icon
          name="chevronDown"
          size={20}
          className={`shrink-0 text-accent ${open ? "rotate-180 transition-transform" : "transition-transform"}`}
        />
      </div>
      <div id={detail} hidden={!open} className="border-t border-line">
        <MemberDetail memberId={memberId} name={name} lines={lines} fundHref={fundHref} formats={formats} />
      </div>
    </section>
  );
}

/** The first letter of a name, for its avatar; a name is never empty, but a blank one leaves the circle empty. */
const initialOf = (name: string): string => [...name.trim()][0]?.toUpperCase() ?? "";

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
  return (
    <ul
      aria-label={t("matrix.memberCaption", { member: name })}
      className="flex flex-col divide-y divide-line"
    >
      {lines.map((line) => {
        const cell = line.members.find((c) => c.memberId === memberId);
        return cell ? (
          <LineItem key={line.lineId} line={line} cell={cell} fundHref={fundHref} formats={formats} />
        ) : null;
      })}
    </ul>
  );
}

/**
 * Board E9-10 03: a line as its name with the member's gap at the right ("+$ 312.000 de más"), and one caption of
 * the figures the API answers, "Asignado · Aportó · Consumió", followed by why any of them is missing (ruling P217),
 * so a missing figure is written in words, never as a lone dash. A fund-level line links to the Fund view in place.
 */
function LineItem({
  line,
  cell,
  fundHref,
  formats,
}: {
  readonly line: MatrixLine;
  readonly cell: MatrixCell;
  readonly fundHref: string;
  readonly formats: Pick<Formats, "numberFormat">;
}) {
  const t = useTranslations("reports");
  const nameId = useId();
  const money = (value: MoneyDto) => formatMoney(value, formats);
  const shown = FIGURES.flatMap((column) => {
    const value = cell[column];
    return value ? [`${t(`matrix.${column}`)} ${money(value)}`] : [];
  });
  const missing = ([...FIGURES, "gap"] as const).filter((column) => cell[column] === null);
  const reasons = [...new Set(missing.map((column) => missingReason(line, column, t)))];
  return (
    <li data-line={line.lineId} aria-labelledby={nameId} className="flex flex-col gap-0.5 px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span id={nameId} className="min-w-0 font-semibold text-ink [overflow-wrap:anywhere]">
          {line.name}
        </span>
        {cell.gap ? (
          <span data-gap className="shrink-0 text-right font-semibold text-ink tabular-nums">
            {formatSignedMoney(cell.gap, formats)}
            {cell.status ? ` ${t(`status.${cell.status}`)}` : null}
          </span>
        ) : null}
      </div>
      <p data-caption className="text-sm text-muted tabular-nums">
        {[...shown, ...reasons].join(" · ")}
      </p>
      {line.reason === "TRACKED_AT_FUND_LEVEL" ? (
        <Link
          href={fundHref}
          className="inline-flex min-h-11 items-center self-start font-semibold text-accent"
        >
          {t("matrix.toFund")}
        </Link>
      ) : null}
    </li>
  );
}
