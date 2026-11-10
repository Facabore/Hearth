import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Icon, ScreenHeader, VisuallyHidden } from "@/shared/ui";
import type { CashFlowDto, SpaceDto } from "@/shared/ui/api/dto";
import { formatDate, formatMoney, formatSignedMoney, type Formats } from "@/shared/ui/format/formatters";
import { chipClass, PlanTabs } from "../plan-tabs";
import { calendarHref } from "../views";

const WINDOWS = [30, 60] as const;

type Money = CashFlowDto["opening"];
type Movement = CashFlowDto["dates"][number]["movements"][number];

const negative = (money: Money): boolean => BigInt(money.amount) < 0n;

/**
 * #150 (ruling P241 of M6c): the personal space's Próximos view. What comes into and goes out of the caller's own
 * accounts over the next 30 or 60 days, date by date, with the balance after each. Every figure is the API's (ruling
 * P201), only known items are listed (P245), every date is formatted from its `YYYY-MM-DD` text (P246), and it records
 * nothing, so it offers no action (P247). With nothing scheduled, it links to the recurring form instead (ruling P270,
 * #178 item 4). A Server Component: no client island, no chart.
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
    <div className="mx-auto flex w-full max-w-[720px] min-w-0 flex-col gap-3 py-3">
      {/* Ruling P311: a stacked screen titled Plan, its way back the space's Configuración, as every Plan view. */}
      <ScreenHeader backHref={`/spaces/${space.id}/settings`} title={t("title")} />
      {/* Board E9-09 12 (ruling P272): the Plan views first, then this view's title, what it lists, and its window. */}
      <PlanTabs space={space} view="calendar" />
      <div className="flex flex-col gap-1">
        <h2 className="text-[17px] leading-tight font-semibold">
          {t("calendar.title", { days: flow.days })}
        </h2>
        <p className="text-sm text-muted">{t("calendar.explain")}</p>
      </div>
      <nav aria-label={t("calendar.window")} className="flex gap-2">
        {WINDOWS.map((days) => (
          <Link
            key={days}
            href={calendarHref(space, days)}
            replace
            aria-current={days === flow.days ? "page" : undefined}
            className={chipClass(days === flow.days)}
          >
            {t("calendar.days", { days })}
          </Link>
        ))}
      </nav>

      {/* Board 11 (ruling P272, #77): with nothing scheduled there is no summary, only the empty card. */}
      {flow.dates.length === 0 ? null : <FlowSummary flow={flow} formats={formats} />}

      {flow.otherCurrencySpaces.map((other) => (
        <p key={other.spaceId} className="text-sm break-words text-muted">
          {t("calendar.otherCurrency", { space: other.name, currency: other.currency })}
        </p>
      ))}

      {flow.dates.length === 0 ? (
        <section className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface p-4 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-track text-ink">
            <Icon name="calendar" />
          </span>
          <p className="text-ink">{t("calendar.empty", { days: flow.days })}</p>
          <p className="text-sm text-muted">{t("calendar.emptyHint")}</p>
          <Link
            href={`/spaces/${space.id}/recurrences/new`}
            className="flex min-h-11 w-full items-center justify-center rounded-[14px] bg-accent px-4 text-center font-semibold text-on-accent"
          >
            {t("calendar.add")}
          </Link>
        </section>
      ) : (
        <ol aria-label={t("calendar.listLabel")} className="flex flex-col gap-3">
          {flow.dates.map((date) => (
            <li
              key={date.date}
              aria-labelledby={`flow-${date.date}`}
              data-date={date.date}
              className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3"
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
                className={`text-sm tabular-nums ${negative(date.balanceAfter) ? "text-owe-ink" : "text-muted"}`}
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

/** What the window adds up to: today's available, what comes in and goes out, the end balance and the lowest one. */
function FlowSummary({
  flow,
  formats,
}: {
  readonly flow: CashFlowDto;
  readonly formats: Pick<Formats, "numberFormat" | "dateFormat">;
}) {
  const t = useTranslations("reports.calendar");
  const money = (value: Money) => formatMoney(value, formats);
  return (
    <section aria-labelledby="flow-summary" className="rounded-xl border border-line bg-surface p-3">
      <h2 id="flow-summary">
        <VisuallyHidden>{t("summary")}</VisuallyHidden>
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
            <dt className="text-sm text-muted">{t(key)}</dt>
            <dd className="font-semibold tabular-nums [overflow-wrap:anywhere]">{money(value)}</dd>
          </div>
        ))}
      </dl>
      <p className={`mt-3 text-sm ${negative(flow.lowest.balance) ? "text-owe-ink" : "text-muted"}`}>
        {t("lowest", { balance: money(flow.lowest.balance), date: formatDate(flow.lowest.date, formats) })}
      </p>
    </section>
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
          <span className={negative(movement.effect) ? "text-owe-ink" : undefined}>
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
