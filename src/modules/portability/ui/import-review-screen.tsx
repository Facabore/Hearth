"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, ChoiceGroup, Icon, ScreenHeader, Sheet, SymbolIcon, TextField } from "@/shared/ui";
import { formatCount } from "@/shared/ui/format/count";
import { allTimeZones, zoneCity, zoneOffset } from "@/shared/ui/format/zones";
import { localDateIn } from "@/shared/kernel/time-zone";
import type { ImportPreviewDto, ImportResultDto } from "./dto";
import {
  ButtonRow,
  CAUTION,
  Column,
  LinkRow,
  Pinned,
  RefusalNotice,
  sourceNamesOf,
  RowIcon,
  useCall,
  useDateLabel,
  type ScreenFormats,
} from "./parts";
import { useAdjust, type DraftPlace } from "./use-adjust";

/** A long list stays fast: at most this many zones are drawn (ruling P137, as Settings' zone sheet). */
const MAX_ZONES = 50;
const searchable = (text: string) => text.replaceAll("_", " ").toLowerCase();

/** The zone the movements' times are read in: every IANA zone, searched by name and city. */
function ZoneSheet({
  open,
  onOpenChange,
  value,
  onChoose,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly value: string;
  readonly onChoose: (zone: string) => void;
}) {
  const t = useTranslations("portability.review");
  const [query, setQuery] = useState("");
  const wanted = searchable(query.trim());
  const now = new Date();
  const matches = allTimeZones()
    .filter((zone) => searchable(zone).includes(wanted))
    .slice(0, MAX_ZONES);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
      title={t("zone")}
    >
      <div className="flex flex-col gap-3">
        <TextField
          id="import-zone-search"
          label={t("zoneSearch")}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
        {matches.length === 0 ? (
          <p className="text-sm text-muted">{t("zoneNone", { query: query.trim() })}</p>
        ) : (
          <ChoiceGroup
            label={t("zone")}
            layout="chips"
            value={value}
            options={matches.map((zone) => ({
              value: zone,
              label: t("zoneValue", { city: zoneCity(zone), offset: zoneOffset(zone, now) }),
            }))}
            onValueChange={(zone) => {
              setQuery("");
              onChoose(zone);
              onOpenChange(false);
            }}
          />
        )}
      </div>
    </Sheet>
  );
}

/** "Antes de importar": every line the preview has something to say about, or nothing when it has none. */
function BeforeImport({
  preview,
  formats,
  timeZone,
  today,
  onIncludeDuplicates,
  pending,
}: {
  readonly preview: ImportPreviewDto;
  readonly formats: ScreenFormats;
  readonly timeZone: string;
  readonly today: string;
  readonly onIncludeDuplicates: (include: boolean) => void;
  readonly pending: boolean;
}) {
  const t = useTranslations("portability.review");
  const dateLabel = useDateLabel(formats, today);
  const count = (n: number) => ({ n, count: formatCount(n, formats) });
  const duplicates = preview.duplicates.length;
  const included =
    duplicates > 0 && preview.duplicates.every((key) => preview.includeDuplicates.includes(key));
  const lines = [
    preview.previouslyImportedAt
      ? t("previously", { date: dateLabel(localDateIn(new Date(preview.previouslyImportedAt), timeZone)) })
      : null,
    preview.plan.alreadyImported.length > 0
      ? t("alreadyImported", count(preview.plan.alreadyImported.length))
      : null,
    preview.leftOut.budgets > 0 ? t("budgets", count(preview.leftOut.budgets)) : null,
    preview.leftOut.zeroAmountMovements > 0 ? t("zero", count(preview.leftOut.zeroAmountMovements)) : null,
    preview.plan.adjustmentsInOpeningBalance > 0
      ? t("opening", count(preview.plan.adjustmentsInOpeningBalance))
      : null,
    preview.warnings.length > 0 ? t("dateZone", count(preview.warnings.length)) : null,
    preview.errors.length > 0 ? t("rowErrors", count(preview.errors.length)) : null,
  ].filter((line): line is string => line !== null);
  if (duplicates === 0 && lines.length === 0) return null;
  return (
    <section aria-labelledby="review-before" className={`flex flex-col gap-2 rounded-2xl p-4 ${CAUTION}`}>
      <h2 id="review-before" className="flex items-center gap-2 text-[15px] font-semibold">
        <Icon name="alert" size={18} />
        {t("before")}
      </h2>
      {duplicates > 0 ? (
        <div className="flex flex-col items-start gap-1">
          <p className="text-sm">
            {included ? t("duplicatesIncluded", count(duplicates)) : t("duplicates", count(duplicates))}
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => onIncludeDuplicates(!included)}
            className="min-h-11 text-sm font-semibold underline underline-offset-2 disabled:opacity-50"
          >
            {included ? t("exclude") : t("include")}
          </button>
        </div>
      ) : null}
      {lines.map((line) => (
        <p key={line} className="text-sm">
          {line}
        </p>
      ))}
    </section>
  );
}

/**
 * D28, board "3 · Importar · revisar antes de importar": the dry run. Its counts by kind and date range, the accounts and
 * the categories with their proposals (each leads to its own screen), the zone the times are read in (the person's by
 * default), and what the import leaves out or warns about. "Importar N movimientos" confirms once: the screen keeps one
 * idempotency key, so a confirm sent again after a lost answer is the same confirm.
 */
export function ImportReviewScreen({
  backHref,
  base,
  preview,
  formats,
  today,
  timeZone,
  draft,
  onConfirmed,
}: {
  readonly backHref: string;
  /** The review's own address; the accounts and categories screens sit under it. */
  readonly base: string;
  readonly preview: ImportPreviewDto;
  readonly formats: ScreenFormats;
  readonly today: string;
  /** The person's own zone, the one the draft starts with. */
  readonly timeZone: string;
  readonly draft: DraftPlace;
  readonly onConfirmed: (result: ImportResultDto) => void;
}) {
  const t = useTranslations("portability");
  const dateLabel = useDateLabel(formats, today);
  const busy = t("busy");
  const adjusting = useAdjust(draft);
  const confirming = useCall();
  const [key] = useState(() => crypto.randomUUID());
  const [zoneOpen, setZoneOpen] = useState(false);
  const count = (n: number) => formatCount(n, formats);
  const { counts } = preview;
  const newAccounts = preview.accounts.filter((a) => a.mapping.kind === "new").length;
  // P337: what the file's categories land on, in their groups.
  const planned = preview.categories.groups.flatMap((g) => g.categories);
  const newCategories = planned.filter((c) => c.target === "new").length;
  const zone = t("review.zoneValue", {
    city: zoneCity(preview.timeZone),
    offset: zoneOffset(preview.timeZone, new Date()),
  });
  const confirm = async () => {
    const result = await confirming.run(() =>
      adjusting.api.POST("/api/v1/spaces/{spaceId}/imports/{importId}/confirm", {
        params: {
          path: { spaceId: draft.spaceId, importId: draft.importId },
          header: { "idempotency-key": key },
        },
      }),
    );
    if (result) onConfirmed(result);
  };
  const kinds = [
    { label: t("review.expense"), value: counts.expense },
    { label: t("review.income"), value: counts.income },
    { label: t("review.transfer"), value: counts.transfer, note: t("review.transferNote") },
    { label: t("review.adjustment"), value: counts.adjustment },
  ];
  const movements = preview.plan.movements;
  return (
    <Column>
      <ScreenHeader backHref={backHref} title={t("review.title")} />
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted">
          {t(`source.${preview.sourceApp === "money-manager" ? "money-manager" : "other"}`)}
        </p>
        <p className="text-[28px] leading-tight font-semibold text-ink">
          {t("movements", { n: counts.total, count: count(counts.total) })}
        </p>
        {preview.dateRange ? (
          <p className="text-sm text-muted">
            {t("review.range", {
              first: dateLabel(preview.dateRange.first),
              last: dateLabel(preview.dateRange.last),
            })}
          </p>
        ) : null}
      </div>
      <dl aria-label={t("review.kinds")} className="divide-y divide-line">
        {kinds.map((kind) => (
          <div key={kind.label} className="flex min-h-11 items-center gap-3 py-2">
            <dt className="flex min-w-0 flex-1 flex-col">
              <span className="text-[15px] text-ink">{kind.label}</span>
              {kind.note ? <span className="text-[13px] text-muted">{kind.note}</span> : null}
            </dt>
            <dd className="font-semibold text-ink tabular-nums">{count(kind.value)}</dd>
          </div>
        ))}
      </dl>
      <ul className="divide-y divide-line">
        <li>
          <LinkRow
            href={`${base}/accounts`}
            icon={
              <RowIcon>
                <SymbolIcon name="wallet" size={20} />
              </RowIcon>
            }
            title={t("review.accounts")}
            note={t("review.accountsNote", {
              total: count(preview.accounts.length),
              created: count(newAccounts),
              existing: count(preview.accounts.length - newAccounts),
            })}
            action={t("review.check")}
          />
        </li>
        <li>
          <LinkRow
            href={`${base}/categories`}
            icon={
              <RowIcon>
                <SymbolIcon name="tag" size={20} />
              </RowIcon>
            }
            title={t("review.categories")}
            note={t("review.categoriesNote", {
              total: count(planned.length),
              created: count(newCategories),
              existing: count(planned.length - newCategories),
            })}
            action={t("review.check")}
          />
        </li>
        <li>
          <ButtonRow
            onClick={() => setZoneOpen(true)}
            icon={
              <RowIcon>
                <Icon name="calendar" size={20} />
              </RowIcon>
            }
            title={t("review.zone")}
            note={preview.timeZone === timeZone ? t("review.zoneProfile", { zone }) : zone}
          />
        </li>
      </ul>
      <BeforeImport
        preview={preview}
        formats={formats}
        timeZone={timeZone}
        today={today}
        pending={adjusting.pending}
        onIncludeDuplicates={(include) =>
          void adjusting.adjust({ includeDuplicates: include ? [...preview.duplicates] : [] })
        }
      />
      {adjusting.refusal ? (
        <RefusalNotice refusal={adjusting.refusal} tooMany={busy} sourceNames={sourceNamesOf(preview)} />
      ) : null}
      {confirming.refusal ? (
        <RefusalNotice refusal={confirming.refusal} tooMany={busy} sourceNames={sourceNamesOf(preview)} />
      ) : null}
      <ZoneSheet
        open={zoneOpen}
        onOpenChange={setZoneOpen}
        value={preview.timeZone}
        onChoose={(chosen) => void adjusting.adjust({ timeZone: chosen })}
      />
      <Pinned>
        <Button
          size="lgFlow"
          className="min-h-14"
          disabled={confirming.pending || adjusting.pending || movements === 0}
          onClick={() => void confirm()}
        >
          {confirming.pending
            ? t("review.confirming")
            : movements === 0
              ? t("review.nothing")
              : t("review.confirm", { n: movements, count: count(movements) })}
        </Button>
      </Pinned>
    </Column>
  );
}
