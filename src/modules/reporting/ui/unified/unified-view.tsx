import { useId } from "react";
import { useTranslations } from "next-intl";
import type { MoneyDto, UnifiedViewDto } from "@/shared/ui/api/dto";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";
import { barWidth } from "../lines/bar";

const CARD = "flex flex-col gap-1 rounded-2xl border border-line bg-surface p-3.5";
const TRACK = "block h-1.5 w-full overflow-hidden rounded-full bg-track";

/**
 * HU-E9-11 (the Unified artboard): the person's consumption and cash out across their spaces, as the API answered
 * them (ruling P201), where the cash out comes from, and the consumption by category. A merged row (a seeded
 * category) wears its name; a custom one wears its space (`reports.spaceScoped`). The bars are CSS widths inside the
 * rows that carry the figures (ruling P202).
 */
export function UnifiedView({
  view,
  formats,
}: {
  readonly view: UnifiedViewDto;
  readonly formats: Pick<Formats, "numberFormat">;
}) {
  const t = useTranslations("reports.unified");
  const tr = useTranslations("reports");
  const base = useId();
  const money = (value: MoneyDto) => formatMoney(value, formats);
  const { consumption, cashOut } = view;
  const largest = consumption.categories[0]?.amount;
  const sources = [
    { key: "payments", amount: cashOut.payments },
    { key: "fundContributions", amount: cashOut.fundContributions },
    { key: "savingsTransfers", amount: cashOut.savingsTransfers },
  ] as const;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            { key: "consumption", total: consumption.total, hint: t("consumptionHint") },
            { key: "cashOut", total: cashOut.total, hint: t("cashOutHint") },
          ] as const
        ).map((card) => (
          <section key={card.key} aria-labelledby={`${base}-${card.key}`} className={CARD}>
            <p id={`${base}-${card.key}`} className="text-sm text-muted">
              {t(card.key)}
            </p>
            <p className="text-2xl font-semibold tabular-nums [overflow-wrap:anywhere]">
              {money(card.total)}
            </p>
            <p className="text-sm text-muted">{card.hint}</p>
          </section>
        ))}
      </div>
      <section aria-labelledby={`${base}-sources`} className={CARD}>
        <h2 id={`${base}-sources`} className="text-lg font-semibold">
          {t("sources")}
        </h2>
        <dl className="flex flex-col gap-1 tabular-nums">
          {[
            ...sources.map((source) => ({ label: t(source.key), amount: source.amount })),
            ...(cashOut.outsideTheApp.amount !== "0"
              ? [{ label: tr("outsideTheApp"), amount: cashOut.outsideTheApp }]
              : []),
          ].map((row) => (
            <div key={row.label} className="flex justify-between gap-3 py-0.5">
              <dt className="min-w-0 text-muted [overflow-wrap:anywhere]">{row.label}</dt>
              <dd className="text-right font-semibold [overflow-wrap:anywhere]">{money(row.amount)}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-labelledby={`${base}-categories`} className="flex flex-col gap-2">
        <h2 id={`${base}-categories`} className="text-lg font-semibold">
          {t("byCategory")}
        </h2>
        {largest ? (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {consumption.categories.map((row, index) => {
              const nameId = `${base}-row-${index}`;
              return (
                <li
                  key={`${row.key ?? row.category?.id ?? index}`}
                  aria-labelledby={nameId}
                  className="flex flex-col gap-1.5 px-3 py-2.5"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span id={nameId} className="min-w-0 font-semibold [overflow-wrap:anywhere]">
                      {row.space ? tr("spaceScoped", { space: row.space.name, name: row.name }) : row.name}
                    </span>
                    <span className="text-right tabular-nums [overflow-wrap:anywhere]">
                      {money(row.amount)}
                    </span>
                  </div>
                  <span aria-hidden="true" className={TRACK}>
                    <span
                      data-bar
                      className="block h-full rounded-full bg-accent"
                      style={{ width: `${barWidth(row.amount, largest)}%` }}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t("empty")}</p>
        )}
      </section>
      {view.otherCurrencySpaces.map((space) => (
        <p key={space.spaceId} className="text-sm text-muted [overflow-wrap:anywhere]">
          {t("otherCurrency", { name: space.name, currency: space.currency })}
        </p>
      ))}
    </>
  );
}
