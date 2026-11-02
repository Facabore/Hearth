import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { MoneyDto } from "@/shared/ui/api/dto";
import { formatMoney, formatPercent, type Formats } from "@/shared/ui/format/formatters";

export interface CapacityRow {
  readonly memberId: string;
  readonly name: string;
  readonly amount: MoneyDto;
  /** The member's share of the total as the API's two-decimal percent ("40.00"), or null when nobody puts in. */
  readonly share: string | null;
}

/** The bar's tones, one per member in turn: two members read as the board's dark and light green. */
const TONES = ["bg-accent", "bg-accent/55", "bg-accent/30"] as const;

/**
 * HU-E9-08, board 01: what everyone puts in, as a card. Its first line pairs the heading with what is left to assign;
 * then the total, a bar with each member's share and, on one line, each member's amount and share in bold. The bar
 * only repeats those figures (P200: never colour alone), so it is hidden from assistive technology.
 */
export function CapacityCard({
  headingId,
  total,
  unallocated,
  rows,
  formats,
  action,
}: {
  readonly headingId: string;
  readonly total: MoneyDto;
  readonly unallocated: MoneyDto;
  readonly rows: readonly CapacityRow[];
  readonly formats: Formats;
  readonly action?: ReactNode;
}) {
  const t = useTranslations("budgeting.planner");
  const money = (value: MoneyDto) => formatMoney(value, formats);
  const shared = rows.filter((row) => row.share !== null && !/^0*\.?0*$/.test(row.share));
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 tabular-nums"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={headingId} className="text-sm font-normal text-muted">
          {t("capacity")}
        </h2>
        <p className="text-sm [overflow-wrap:anywhere] text-muted">
          {t("unallocated", { amount: money(unallocated) })}
        </p>
      </div>
      <p className="text-3xl font-semibold [overflow-wrap:anywhere] text-ink">{money(total)}</p>
      {shared.length > 0 ? (
        <div data-share-bar aria-hidden="true" className="flex h-2 gap-0.5 overflow-hidden rounded-full">
          {shared.map((row, index) => (
            <span
              key={row.memberId}
              className={`${TONES[index % TONES.length]} min-w-1 shrink grow-0 rounded-full`}
              style={{ flexBasis: `${row.share}%` }}
            />
          ))}
        </div>
      ) : null}
      <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm text-ink">
        {rows.map((row) => (
          <span key={row.memberId} className="[overflow-wrap:anywhere]">
            {t("memberAmount", { name: row.name, amount: money(row.amount) })}
            {row.share === null ? null : (
              <>
                {" · "}
                <strong className="font-semibold">{formatPercent(row.share, formats)}</strong>
              </>
            )}
          </span>
        ))}
      </p>
      {action}
    </section>
  );
}
