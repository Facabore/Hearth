import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { shownAmount, useAmountsHidden } from "@/modules/spaces/ui";
import { Icon, paletteVars } from "@/shared/ui";
import { SpaceChip } from "@/shared/ui/atoms/space-chip";
import type { MoneyDto, SpaceDto, TransactionPageDto } from "@/shared/ui/api/dto";
import { formatDate, type Formats } from "@/shared/ui/format/formatters";
import { periodName } from "@/shared/ui/time/period-name";
import type { MonthPart, UnifiedMonth } from "./feed";

/** A share of the bar in basis points, from the amounts (bigint, minor units); a share that shows is never under 2 %. */
const shareOf = (amount: MoneyDto, total: MoneyDto): number => {
  const whole = BigInt(total.amount);
  return whole <= 0n ? 0 : Math.max(200, Number((BigInt(amount.amount) * 10_000n) / whole));
};

/**
 * One part of the month, "Solo tú" or "Con otros": a button with its amount that opens, in the card, a bar in the
 * colors of what it holds and the list of it, each named (never color alone); the bar itself is decoration.
 */
function Part({
  label,
  part,
  chips,
  money,
  hrefOf,
}: {
  readonly label: string;
  readonly part: MonthPart;
  /** Groups wear their space's chip; categories a dot of their color before their name. */
  readonly chips: boolean;
  readonly money: (amount: MoneyDto) => string;
  /** Ruling P310: where a row opens its movements; a row without one (not known yet) stays plain. */
  readonly hrefOf?: ((id: string) => string | undefined) | undefined;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const any = part.items.length > 0;
  const head = (
    <>
      <span className="font-medium text-ink">{label}</span>
      <span className="flex items-center gap-1.5 font-semibold whitespace-nowrap text-ink">
        {money(part.amount)}
        {any ? (
          <Icon
            name="chevronDown"
            size={18}
            className={open ? "rotate-180 transition-transform" : "transition-transform"}
          />
        ) : null}
      </span>
    </>
  );
  return (
    <div className="flex flex-col">
      {any ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((was) => !was)}
          className="flex min-h-12 items-center justify-between gap-3 text-left"
        >
          {head}
        </button>
      ) : (
        <div className="flex min-h-12 items-center justify-between gap-3">{head}</div>
      )}
      {any ? (
        <div id={id} hidden={!open} className="flex flex-col gap-2 pb-2">
          <div aria-hidden="true" className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
            {part.items.map((item) => (
              <span
                key={item.id}
                style={{
                  ...paletteVars(item.color ?? "GRAPHITE"),
                  flexGrow: shareOf(item.amount, part.amount),
                }}
                className="h-full bg-[var(--ink)]"
              />
            ))}
          </div>
          <ul className="flex flex-col">
            {part.items.map((item) => {
              const href = hrefOf?.(item.id);
              const row = (
                <>
                  {chips ? (
                    <SpaceChip name={item.name} color={item.color ?? "GRAPHITE"} />
                  ) : (
                    <span className="flex min-w-0 items-center gap-2 text-ink-2">
                      <span
                        aria-hidden="true"
                        style={paletteVars(item.color ?? "GRAPHITE")}
                        className="size-2.5 shrink-0 rounded-full bg-[var(--ink)]"
                      />
                      <span className="[overflow-wrap:anywhere]">{item.name}</span>
                    </span>
                  )}
                  <span className="ml-auto shrink-0 font-semibold whitespace-nowrap text-ink">
                    {money(item.amount)}
                  </span>
                </>
              );
              // Ruling P310: each row opens the movements behind its amount, a 44 px target ending in a chevron.
              return (
                <li key={item.id}>
                  {href ? (
                    <Link href={href} className="flex min-h-11 items-center gap-3 text-sm">
                      {row}
                      <Icon name="chevronRight" size={18} className="shrink-0 text-muted" />
                    </Link>
                  ) : (
                    <p className="flex min-h-11 items-center gap-3 text-sm">{row}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Ruling P306 (boards "Inicio personal · solo tú y con otros · cerrado" and "… · abiertos", amending the switch of
 * "Tu parte / Lo que pagaste"): the personal Inicio's headline for someone with other spaces. One figure, what her month
 * cost her, and its two parts, "Solo tú" and "Con otros", each opening in the card. What she paid for others lives in
 * "Te toca poner / recibir" under it. It draws in the first paint, so it never moves what is under it.
 */
export function UnifiedSummary({
  unified,
  page,
  policy,
  formats,
  personId,
  soloHref,
  othersHref,
}: {
  readonly unified: UnifiedMonth;
  readonly page: TransactionPageDto;
  readonly policy: SpaceDto["periodPolicy"];
  readonly formats: Formats;
  /** Ruling P278: Inicio's eye hides every amount. */
  readonly personId: string;
  /** Ruling P310: where a "Solo tú" category opens its movements. */
  readonly soloHref?: ((categoryId: string) => string | undefined) | undefined;
  /** Ruling P310: where a "Con otros" space opens its movements. */
  readonly othersHref?: ((spaceId: string) => string | undefined) | undefined;
}) {
  const t = useTranslations("home");
  const common = useTranslations("common");
  const hidden = useAmountsHidden(personId);
  const money = (amount: MoneyDto) => shownAmount(amount, hidden, formats);
  const name = periodName(page.period, policy);
  return (
    <section aria-label={t("summary")} className="flex flex-col rounded-2xl bg-surface p-3">
      <p className="text-sm text-muted">
        {name.kind === "month"
          ? t("spentIn", { month: common(`month.${name.month as 1}`) })
          : t("spentBetween", { start: formatDate(name.start, formats), end: formatDate(name.end, formats) })}
      </p>
      <p className="text-[clamp(1.75rem,8.5vw,2rem)] leading-tight font-semibold [overflow-wrap:anywhere] text-ink">
        {money(unified.consumed)}
      </p>
      <div className="mt-1 flex flex-col divide-y divide-line">
        <Part label={t("solo")} part={unified.solo} chips={false} money={money} hrefOf={soloHref} />
        <Part label={t("withOthers")} part={unified.withOthers} chips money={money} hrefOf={othersHref} />
      </div>
      <p className="text-sm text-muted">{t("income", { amount: money(page.totals.income) })}</p>
    </section>
  );
}
