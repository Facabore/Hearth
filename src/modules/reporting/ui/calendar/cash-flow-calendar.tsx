import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, VisuallyHidden } from "@/shared/ui";
import type { CashFlowDto, SpaceDto } from "@/shared/ui/api/dto";
import { formatDate, formatMoney, formatSignedMoney, type Formats } from "@/shared/ui/format/formatters";
import { PlanTabs } from "../plan-tabs";
import { calendarHref } from "../views";

const WINDOWS = [30, 60] as const;

type Money = CashFlowDto["opening"];
type Movement = CashFlowDto["dates"][number]["movements"][number];

const negative = (money: Money): boolean => BigInt(money.amount) < 0n;

/**
 * #150 (ruling P241 of M6c): the personal space's Próximos view. What comes into and goes out of the caller's own
 * accounts over the next 30 or 60 days, date by date, with the balance after each. Every figure is the API's (ruling
 * P201), only known items are listed (P245), every date is formatted from its `YYYY-MM-DD` text (P246), and it records
 * nothing, so it offers no action (P247). A Server Component: no client island, no chart.
 */
export function CashFlowCalendar({
  space,
  flow,
  formats,
}: {
  readonly space: SpaceDto;
  readonly flow: CashFlowDto;
  readonly formats: Pick<Formats, "numberFormat" | "dateFormat">;
}) {
  const t = useTranslations("reports");
  const money = (value: Money) => formatMoney(value, formats);
  return (
    <div className="mx-auto flex w-full max-w-[720px] min-w-0 flex-col gap-3 py-4">
      <header className="flex flex-col gap-1">
        <p className="text-sm break-words text-muted">{space.name}</p>
        <h1 className="text-xl font-semibold">{t("calendar.title", { days: flow.days })}</h1>
      </header>
      <nav aria-label={t("calendar.window")} className="flex gap-2">
        {WINDOWS.map((days) => (
          <Link
            key={days}
            href={calendarHref(space, days)}
            aria-current={days === flow.days ? "page" : undefined}
            className={`flex min-h-11 items-center rounded-full px-4 text-sm font-medium ${
              days === flow.days ? "bg-accent-soft text-accent" : "border border-line bg-surface text-ink"
            }`}
          >
            {t("calendar.days", { days })}
          </Link>
        ))}
      </nav>
      <PlanTabs space={space} view="calendar" />
      <p className="text-sm text-muted">{t("calendar.explain")}</p>

      <section aria-labelledby="flow-summary" className="rounded-xl border border-line bg-surface p-4">
        <h2 id="flow-summary">
          <VisuallyHidden>{t("calendar.summary")}</VisuallyHidden>
        </h2>
        <dl className="grid grid-cols-2 gap-3">
          {(
            [
              ["opening", flow.opening],
              ["incoming", flow.totals.incoming],
              ["outgoing", flow.totals.outgoing],
              ["closing", flow.totals.closing],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className="flex min-w-0 flex-col">
              <dt className="text-sm text-muted">{t(`calendar.${key}`)}</dt>
              <dd className="font-semibold tabular-nums">{money(value)}</dd>
            </div>
          ))}
        </dl>
        <p className={`mt-3 text-sm ${negative(flow.lowest.balance) ? "text-owe" : "text-muted"}`}>
          {t("calendar.lowest", {
            balance: money(flow.lowest.balance),
            date: formatDate(flow.lowest.date, formats),
          })}
        </p>
      </section>

      {flow.otherCurrencySpaces.map((other) => (
        <p key={other.spaceId} className="text-sm break-words text-muted">
          {t("calendar.otherCurrency", { space: other.name, currency: other.currency })}
        </p>
      ))}

      {flow.dates.length === 0 ? (
        <p className="text-muted">{t("calendar.empty", { days: flow.days })}</p>
      ) : (
        <ol aria-label={t("calendar.listLabel")} className="flex flex-col gap-3">
          {flow.dates.map((date) => (
            <li
              key={date.date}
              aria-labelledby={`flow-${date.date}`}
              data-date={date.date}
              className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4"
            >
              <h2 id={`flow-${date.date}`} className="font-semibold">
                {formatDate(date.date, formats)}
              </h2>
              <ul className="flex flex-col gap-2">
                {date.movements.map((movement) => (
                  <MovementRow
                    key={`${movement.recurrenceId}-${movement.occurrenceId ?? movement.dueDate}`}
                    movement={movement}
                    formats={formats}
                  />
                ))}
              </ul>
              <p
                className={`text-sm tabular-nums ${negative(date.balanceAfter) ? "text-owe" : "text-muted"}`}
              >
                {t("calendar.balanceAfter", { balance: money(date.balanceAfter) })}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** One movement: what it is, where it comes from, its badges, and how it changes the caller's available money. */
function MovementRow({
  movement,
  formats,
}: {
  readonly movement: Movement;
  readonly formats: Pick<Formats, "numberFormat" | "dateFormat">;
}) {
  const t = useTranslations("reports.calendar");
  const moves = BigInt(movement.effect.amount) !== 0n;
  return (
    <li className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-medium break-words">{movement.description}</span>
        <span className="text-sm break-words text-muted">
          {t(`type.${movement.type}`)} · {movement.space.name}
        </span>
        {movement.status === "PENDING" || movement.estimated ? (
          <span className="flex flex-wrap gap-1">
            {movement.status === "PENDING" ? (
              <Badge>{t("pending", { date: formatDate(movement.dueDate, formats) })}</Badge>
            ) : null}
            {movement.estimated ? <Badge>{t("estimated")}</Badge> : null}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end text-right tabular-nums">
        {moves ? (
          <span className={negative(movement.effect) ? "text-owe" : undefined}>
            {formatSignedMoney(movement.effect, formats)}
          </span>
        ) : (
          <>
            <span>{formatMoney(movement.amount, formats)}</span>
            <span className="text-sm text-muted">{t("noEffect")}</span>
          </>
        )}
      </div>
    </li>
  );
}
