"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Icon, ScreenHeader, SymbolIcon } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import { formatCount } from "@/shared/ui/format/count";
import type { ImportCountsDto, ImportPreviewDto } from "./dto";
import {
  Column,
  LinkRow,
  Pinned,
  RowIcon,
  StaticRow,
  useDateLabel,
  useNameList,
  type ScreenFormats,
} from "./parts";
import { UndoImportSheet } from "./undo-import-sheet";

export interface DonePlace {
  /** Volver and the way out after an undo: Importar y exportar. */
  readonly hubHref: string;
  readonly transactionsHref: string;
  readonly accountsHref: string;
  readonly categoriesHref: string;
  readonly personal: { readonly id: string; readonly name: string };
  readonly importId: string;
}

const NONE: ImportCountsDto = {
  accountsCreated: 0,
  accountsRestored: 0,
  categoriesCreated: 0,
  categoriesRestored: 0,
  movementsImported: 0,
  alreadyImported: 0,
  duplicatesSkipped: 0,
  adjustmentsInOpeningBalance: 0,
  adjustmentsNotImported: 0,
  rowErrors: 0,
  peopleCreated: 0,
  accountsArchived: 0,
  hearthCategoriesArchived: 0,
};

/**
 * D28, board "6 · Importar · listo": what the import did (its movements, the accounts and categories it created or
 * restored from an undone import, the look-alikes left out, the rows the ledger refused) and the way to undo it. A balance adjustment is a movement
 * like any other since #329: one the ledger refused is among the refused rows, and is never counted twice. The names and the date range come from the
 * draft's preview when this visit still holds it; a later visit has the counts alone. Undo asks first, as everywhere.
 */
export function ImportDoneScreen({
  place,
  counts,
  preview,
  undoable,
  formats,
  today,
  onUndone,
  api,
}: {
  readonly place: DonePlace;
  readonly counts: ImportCountsDto | null;
  readonly preview: ImportPreviewDto | null;
  /** Whether the import is still CONFIRMED, so it can be undone. */
  readonly undoable: boolean;
  readonly formats: ScreenFormats;
  readonly today: string;
  readonly onUndone: () => void;
  readonly api?: Api;
}) {
  const t = useTranslations("portability.done");
  const dateLabel = useDateLabel(formats, today);
  const names = useNameList();
  const [undoing, setUndoing] = useState(false);
  const done = counts ?? NONE;
  const count = (n: number) => ({ n, count: formatCount(n, formats) });
  const createdAccounts = (preview?.accounts ?? [])
    // The names the confirm gave them, which differ from the file's when those were taken.
    .flatMap((a) => (a.mapping.kind === "new" ? [a.mapping.name] : []));
  const range = preview?.dateRange;
  return (
    <Column>
      <ScreenHeader backHref={place.hubHref} title={t("title")} />
      <div className="flex flex-col items-center gap-2 py-4 text-center">
        <span
          aria-hidden="true"
          className="flex size-16 items-center justify-center rounded-full bg-accent-soft text-accent"
        >
          <Icon name="check" size={32} />
        </span>
        <h2 className="text-[22px] font-semibold text-ink">{t("headline", count(done.movementsImported))}</h2>
        <p className="text-[15px] text-muted">
          {range
            ? t("where", {
                first: dateLabel(range.first),
                last: dateLabel(range.last),
                space: place.personal.name,
              })
            : t("whereOnly", { space: place.personal.name })}
        </p>
      </div>
      <ul className="divide-y divide-line">
        {done.accountsCreated > 0 ? (
          <li>
            <LinkRow
              href={place.accountsHref}
              icon={
                <RowIcon>
                  <SymbolIcon name="wallet" size={20} />
                </RowIcon>
              }
              title={t("accounts", count(done.accountsCreated))}
              note={createdAccounts.length > 0 ? names(createdAccounts) : undefined}
            />
          </li>
        ) : null}
        {done.categoriesCreated > 0 ? (
          <li>
            <LinkRow
              href={place.categoriesHref}
              icon={
                <RowIcon>
                  <SymbolIcon name="tag" size={20} />
                </RowIcon>
              }
              title={t("categories", count(done.categoriesCreated))}
              note={t("categoriesNote")}
            />
          </li>
        ) : null}
        {done.accountsRestored > 0 ? (
          <li>
            <LinkRow
              href={place.accountsHref}
              icon={
                <RowIcon>
                  <SymbolIcon name="wallet" size={20} />
                </RowIcon>
              }
              title={t("accountsRestored", count(done.accountsRestored))}
              note={t("restoredNote")}
            />
          </li>
        ) : null}
        {done.categoriesRestored > 0 ? (
          <li>
            <LinkRow
              href={place.categoriesHref}
              icon={
                <RowIcon>
                  <SymbolIcon name="tag" size={20} />
                </RowIcon>
              }
              title={t("categoriesRestored", count(done.categoriesRestored))}
              note={t("restoredNote")}
            />
          </li>
        ) : null}
        {done.duplicatesSkipped > 0 ? (
          <li>
            <StaticRow
              icon={
                <RowIcon tone="warn">
                  <Icon name="alert" size={20} />
                </RowIcon>
              }
              title={t("duplicates", count(done.duplicatesSkipped))}
              note={t("duplicatesNote")}
            />
          </li>
        ) : null}
        {done.rowErrors > 0 ? (
          <li>
            <StaticRow
              icon={
                <RowIcon tone="warn">
                  <Icon name="warning" size={20} />
                </RowIcon>
              }
              title={t("rowErrors", count(done.rowErrors))}
              note={t("rowErrorsNote")}
            />
          </li>
        ) : null}
      </ul>
      {undoable ? <p className="text-sm text-muted">{t("undoNote")}</p> : null}
      <Pinned>
        <Button size="lg" asChild>
          <Link href={place.transactionsHref}>{t("movements")}</Link>
        </Button>
        {undoable ? (
          <Button variant="ghost" size="lg" onClick={() => setUndoing(true)}>
            {t("undo")}
          </Button>
        ) : null}
      </Pinned>
      <UndoImportSheet
        open={undoing}
        onOpenChange={setUndoing}
        spaceId={place.personal.id}
        importId={place.importId}
        onUndone={onUndone}
        api={api}
      />
    </Column>
  );
}
