"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Icon, ScreenHeader, SymbolIcon } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import { formatCount } from "@/shared/ui/format/count";
import { localDateIn } from "@/shared/kernel/time-zone";
import type { ImportSummaryDto } from "./dto";
import { Column, LinkRow, RowIcon, SectionTitle, StaticRow, useDateLabel, type ScreenFormats } from "./parts";
import { UndoImportSheet } from "./undo-import-sheet";

export interface HubPlace {
  /** Where Volver goes: the Más of the space the person came from. */
  readonly backHref: string;
  /** This screen's own address; the flow's screens sit under it. */
  readonly base: string;
  /** The person's personal space, where an import goes (design §3.2). */
  readonly personal: { readonly id: string; readonly name: string };
}

const useSourceName = () => {
  const t = useTranslations("portability.source");
  return (app: string) => (t.has(app as "money-manager") ? t(app as "money-manager") : t("other"));
};

function HistoryRow({
  item,
  place,
  formats,
  today,
  timeZone,
  onUndo,
}: {
  readonly item: ImportSummaryDto;
  readonly place: HubPlace;
  readonly formats: ScreenFormats;
  readonly today: string;
  readonly timeZone: string;
  readonly onUndo: () => void;
}) {
  const t = useTranslations("portability");
  const source = useSourceName();
  const dateLabel = useDateLabel(formats, today);
  const date = localDateIn(new Date(item.confirmedAt ?? item.createdAt), timeZone);
  const title = t("hub.historyTitle", { app: source(item.sourceApp), date: dateLabel(date) });
  const moved = item.counts?.movementsImported ?? 0;
  const counts = item.counts
    ? t("hub.historyCounts", {
        movements: t("movements", { n: moved, count: formatCount(moved, formats) }),
        space: place.personal.name,
      })
    : null;
  const note = (
    <>
      {counts ? <span className="block">{counts}</span> : null}
      {item.status === "CONFIRMED" ? null : <span className="block">{t(`hub.status.${item.status}`)}</span>}
    </>
  );
  if (item.status === "DRAFT") {
    return (
      <li>
        <LinkRow
          href={`${place.base}/imports/${item.id}`}
          icon={
            <RowIcon tone="warn">
              <Icon name="alert" size={20} />
            </RowIcon>
          }
          title={title}
          note={note}
        />
      </li>
    );
  }
  return (
    <li className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <StaticRow
          icon={
            <RowIcon>
              <Icon name={item.status === "CONFIRMED" ? "check" : "archive"} size={20} />
            </RowIcon>
          }
          title={title}
          note={note}
          muted={item.status === "UNDONE"}
        />
      </div>
      {item.status === "CONFIRMED" ? (
        <button
          type="button"
          onClick={onUndo}
          aria-label={`${t("hub.undo")}: ${title}`}
          className="min-h-11 min-w-11 shrink-0 rounded-[10px] px-3 text-sm font-semibold text-accent"
        >
          {t("hub.undo")}
        </button>
      ) : null}
    </li>
  );
}

/**
 * D28, board "1 · Importar y exportar · inicio": the sources to import from (Money Manager today; a CSV file and
 * Splitwise still to come, so they open nothing), the way to download one's data, and the personal space's past
 * imports. A confirmed one can be undone from here, behind its confirmation; a draft still to confirm opens its review.
 */
export function ImportHubScreen({
  place,
  history,
  formats,
  today,
  timeZone,
  onUndone,
  api,
}: {
  readonly place: HubPlace;
  readonly history: readonly ImportSummaryDto[];
  readonly formats: ScreenFormats;
  /** The person's own date, `todayIn` their zone. */
  readonly today: string;
  /** The person's zone, which an import's day is counted in. */
  readonly timeZone: string;
  readonly onUndone: () => void;
  readonly api?: Api;
}) {
  const t = useTranslations("portability.hub");
  const source = useSourceName();
  const [undoing, setUndoing] = useState<string | null>(null);
  return (
    <Column>
      <ScreenHeader backHref={place.backHref} title={t("title")} />
      <p className="text-[15px] text-muted">{t("intro")}</p>
      <section aria-labelledby="hub-bring" className="flex flex-col">
        <SectionTitle id="hub-bring">{t("bring")}</SectionTitle>
        <ul className="divide-y divide-line">
          <li>
            <LinkRow
              href={`${place.base}/money-manager`}
              icon={
                <RowIcon>
                  <SymbolIcon name="wallet" size={20} />
                </RowIcon>
              }
              title={source("money-manager")}
              note={t("moneyManagerNote")}
            />
          </li>
          <li>
            <StaticRow
              icon={
                <RowIcon>
                  <Icon name="list" size={20} />
                </RowIcon>
              }
              title={t("csv")}
              note={t("soon")}
              muted
            />
          </li>
          <li>
            <StaticRow
              icon={
                <RowIcon>
                  <SymbolIcon name="users" size={20} />
                </RowIcon>
              }
              title={t("splitwise")}
              note={t("soon")}
              muted
            />
          </li>
        </ul>
        <p className="text-sm text-muted">{t("missing")}</p>
      </section>
      <section aria-labelledby="hub-take" className="flex flex-col">
        <SectionTitle id="hub-take">{t("take")}</SectionTitle>
        <LinkRow
          href={`${place.base}/export`}
          icon={
            <RowIcon>
              <Icon name="link" size={20} />
            </RowIcon>
          }
          title={t("download")}
          note={t("downloadNote")}
        />
      </section>
      <section aria-labelledby="hub-history" className="flex flex-col">
        <SectionTitle id="hub-history">{t("history")}</SectionTitle>
        {history.length === 0 ? (
          <p className="rounded-2xl bg-track p-3 text-sm text-ink">{t("historyEmpty")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {history.map((item) => (
              <HistoryRow
                key={item.id}
                item={item}
                place={place}
                formats={formats}
                today={today}
                timeZone={timeZone}
                onUndo={() => setUndoing(item.id)}
              />
            ))}
          </ul>
        )}
      </section>
      <UndoImportSheet
        open={undoing !== null}
        onOpenChange={(open) => {
          if (!open) setUndoing(null);
        }}
        spaceId={place.personal.id}
        importId={undoing ?? ""}
        onUndone={onUndone}
        api={api}
      />
    </Column>
  );
}
