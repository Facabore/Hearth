"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/shared/ui";
import type { MoneyDto, UnifiedViewDto } from "@/shared/ui/api/dto";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";
import { useOriginText, type Origin } from "../origin";

const CARD = "flex flex-col gap-1 rounded-2xl border border-line bg-surface p-3.5";

type Row = UnifiedViewDto["consumption"]["categories"][number];

/**
 * #240 (board E9-11 01): where a row came from. One shared space's row is the person's part of it ("Hogar · tu parte");
 * any other names its spaces. Nothing when an older API lists none.
 */
const originOf = (spaces: Row["spaces"], personalSpaceId: string | undefined): Origin | null => {
  if (!spaces?.length) return null;
  const [only] = spaces;
  return spaces.length === 1 && personalSpaceId !== undefined && only!.id !== personalSpaceId
    ? { kind: "yourShare", space: only!.name }
    : { kind: "spaces", names: spaces.map((space) => space.name) };
};

/**
 * HU-E9-11 (the Unified artboard): the person's consumption and cash out across their spaces, as the API answered
 * them (ruling P201), where the cash out comes from, and the consumption by category. Decision U10 (#224): one hero
 * figure, "Lo que gastaste tú" (the consumption); "Lo que pagaste" (the cash out) is a secondary line whose
 * "¿Por qué es distinto?" unfolds the answer and where the payments went. A merged row (a seeded category) wears its
 * name; a custom one wears its space (`reports.spaceScoped`). Boards E9-11 01 and 05 (ruling P272): the breakdown sits
 * in an inset card, and the categories are plain rows under a small label, with no bars. "Pagado fuera de la app" is
 * listed only when it is not zero (ruling P218), though board 05 draws it at zero. Under each name, the spaces it came
 * from (#240, board E9-11 01).
 */
export function UnifiedView({
  view,
  formats,
  personalSpaceId,
}: {
  readonly view: UnifiedViewDto;
  readonly formats: Pick<Formats, "numberFormat">;
  /** The person's personal space: a row from one other space is their part of it ("tu parte"). */
  readonly personalSpaceId?: string;
}) {
  const t = useTranslations("reports.unified");
  const tr = useTranslations("reports");
  const originText = useOriginText();
  const base = useId();
  const [why, setWhy] = useState(false);
  const money = (value: MoneyDto) => formatMoney(value, formats);
  const { consumption, cashOut } = view;
  const any = consumption.categories.length > 0;
  const sources = [
    { key: "payments", amount: cashOut.payments },
    { key: "fundContributions", amount: cashOut.fundContributions },
    { key: "savingsTransfers", amount: cashOut.savingsTransfers },
  ] as const;
  return (
    <>
      <div className={CARD}>
        <section aria-labelledby={`${base}-spent`} className="flex flex-col gap-1">
          <p id={`${base}-spent`} className="text-sm text-muted">
            {t("spent")}
          </p>
          <p className="text-3xl font-semibold tabular-nums [overflow-wrap:anywhere]">
            {money(consumption.total)}
          </p>
          <p className="text-sm text-muted">{t("consumptionHint")}</p>
        </section>
        <section aria-labelledby={`${base}-paid`} className="mt-2 flex flex-col border-t border-line pt-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span id={`${base}-paid`} className="text-muted">
              {t("paid")}
            </span>
            <span className="font-semibold tabular-nums [overflow-wrap:anywhere]">
              {money(cashOut.total)}
            </span>
          </div>
          <button
            type="button"
            aria-expanded={why}
            aria-controls={`${base}-why`}
            onClick={() => setWhy((open) => !open)}
            className="-mx-1 flex min-h-11 items-center gap-1 self-start rounded-lg px-1 text-sm font-medium text-accent"
          >
            {t("whyDifferent")}
            <Icon
              name="chevronDown"
              size={18}
              className={why ? "rotate-180 transition-transform" : "transition-transform"}
            />
          </button>
          <div id={`${base}-why`} hidden={!why} className="flex flex-col gap-2">
            <p className="text-sm text-muted">{t("whyDifferentAnswer")}</p>
            <section aria-labelledby={`${base}-sources`} className="flex flex-col gap-1">
              <h2 id={`${base}-sources`} className="text-base font-semibold">
                {t("sources")}
              </h2>
              <dl className="flex flex-col divide-y divide-line rounded-xl bg-bg px-3.5 tabular-nums">
                {[
                  ...sources.map((source) => ({ label: t(source.key), amount: source.amount })),
                  ...(cashOut.outsideTheApp.amount !== "0"
                    ? [{ label: tr("outsideTheApp"), amount: cashOut.outsideTheApp }]
                    : []),
                ].map((row) => (
                  <div key={row.label} className="flex justify-between gap-3 py-2.5">
                    <dt className="min-w-0 text-muted [overflow-wrap:anywhere]">{row.label}</dt>
                    <dd className="text-right font-semibold [overflow-wrap:anywhere]">{money(row.amount)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </section>
      </div>
      <section aria-labelledby={`${base}-categories`} className="flex flex-col gap-2">
        <h2 id={`${base}-categories`} className="text-sm font-semibold text-muted">
          {t("byCategory")}
        </h2>
        {any ? (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {consumption.categories.map((row, index) => {
              const nameId = `${base}-row-${index}`;
              const origin = originOf(row.spaces, personalSpaceId);
              return (
                <li
                  key={`${row.key ?? row.category?.id ?? index}`}
                  aria-labelledby={nameId}
                  className={`flex justify-between gap-3 px-3.5 py-3 ${origin ? "items-center" : "items-baseline"}`}
                >
                  <span className="flex min-w-0 flex-col">
                    <span id={nameId} className="font-semibold [overflow-wrap:anywhere]">
                      {row.space ? tr("spaceScoped", { space: row.space.name, name: row.name }) : row.name}
                    </span>
                    {origin ? (
                      <span data-origin className="text-sm text-muted [overflow-wrap:anywhere]">
                        {originText(origin)}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-right font-semibold tabular-nums [overflow-wrap:anywhere]">
                    {money(row.amount)}
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
