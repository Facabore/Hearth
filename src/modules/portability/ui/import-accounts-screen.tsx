"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AmountText, Button, ScreenHeader } from "@/shared/ui";
import type { AccountDto } from "@/shared/ui/api/dto";
import { cn } from "@/shared/ui/cn";
import { formatCount } from "@/shared/ui/format/count";
import { formatMoney } from "@/shared/ui/format/formatters";
import type { AccountMappingDto, ImportAccountDto, ImportPreviewDto } from "./dto";
import { Column, Pinned, RefusalNotice, sourceNamesOf, type ScreenFormats } from "./parts";
import { useAdjust, type DraftPlace } from "./use-adjust";

/** P337, board 1: what a source account is, as the screen offers it. */
type Kind = keyof ImportAccountDto["options"];

const KINDS: readonly Kind[] = ["account", "person", "archive"];

/** The sections, in the board's order, by what Hearth suggested (it stays as the person changes a row). */
const SECTIONS: readonly ImportAccountDto["suggested"][] = ["ACCOUNT", "PERSON", "ARCHIVE"];

/** What a mapping makes of its source account: a Cuenta (an account of the person's or a new one), Persona or Archivar. */
const kindOf = (mapping: AccountMappingDto): Kind =>
  mapping.kind === "person" ? "person" : mapping.kind === "archive" ? "archive" : "account";

/**
 * The line under an account's name (board 1): its closing balance in the file, and for a Persona whether that person
 * owes the person or is owed, for Archivar why ("igual a Efectivo", "sin movimientos"). A sign or a word always says
 * the direction, never color alone.
 */
function Summary({ item, formats }: { readonly item: ImportAccountDto; readonly formats: ScreenFormats }) {
  const t = useTranslations("portability.accounts");
  const balance = formatMoney(item.sourceClosingBalance, formats);
  const minor = BigInt(item.sourceClosingBalance.amount);
  const { mapping } = item;
  let text = balance;
  if (mapping.kind === "person" && minor !== 0n) {
    text = t(minor > 0n ? "owesYou" : "youOwe", { balance });
  } else if (mapping.kind === "archive") {
    if (item.duplicateOf !== null && mapping.accountId === item.duplicateOf.id) {
      text = t("sameAs", { balance, name: item.duplicateOf.name });
    } else if (item.movementCount === 0) text = t("noMovements", { balance });
    else if (item.hidden) text = t("hidden", { balance });
  }
  return (
    <p className="text-[13px] text-muted">
      <AmountText text={text} />
    </p>
  );
}

/** Cuenta / Persona / Archivar for one account: three buttons, the chosen one pressed and drawn bold and raised. */
function KindChoice({
  item,
  disabled,
  onChoose,
}: {
  readonly item: ImportAccountDto;
  readonly disabled: boolean;
  readonly onChoose: (kind: Kind) => void;
}) {
  const t = useTranslations("portability.accounts");
  const chosen = kindOf(item.mapping);
  return (
    <div
      role="group"
      aria-label={t("choice", { name: item.name })}
      className="flex shrink-0 gap-0.5 rounded-[12px] bg-track p-0.5"
    >
      {KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          aria-pressed={chosen === kind}
          disabled={disabled}
          onClick={() => {
            if (chosen !== kind) onChoose(kind);
          }}
          className={cn(
            "min-h-11 min-w-11 rounded-[10px] border px-2.5 text-[14px]",
            chosen === kind
              ? "border-line bg-surface font-semibold text-accent shadow-sm"
              : "border-transparent text-muted",
          )}
        >
          {t(`kinds.${kind}`)}
        </button>
      ))}
    </div>
  );
}

/**
 * D28, P337, board 1 "¿Qué es cada cuenta?": each account of the file, in Money Manager's order, under the section of
 * what Hearth suggested it is (Cuentas de dinero, Personas, Archivar), with its balance and a three-way choice. A
 * choice sends the mapping the preview offers for it (`options`), so the screen never builds one itself; the API
 * answers the new preview. A Cuenta keeps the file's currency and type; a Persona becomes a guest in the pair's direct
 * space; Archivar keeps the account's history out of the pickers.
 */
export function ImportAccountsScreen({
  backHref,
  preview,
  formats,
  draft,
}: {
  readonly backHref: string;
  readonly preview: ImportPreviewDto;
  /** The person's accounts in their personal space (the preview names the one an account duplicates already). */
  readonly accounts?: readonly AccountDto[];
  readonly formats: ScreenFormats;
  readonly draft: DraftPlace;
}) {
  const t = useTranslations("portability.accounts");
  const busy = useTranslations("portability")("busy");
  const { adjust, pending, refusal } = useAdjust(draft);
  const total = preview.accounts.length;
  const choose = (item: ImportAccountDto, kind: Kind) =>
    void adjust({ accounts: { [item.sourceId]: item.options[kind] } });
  return (
    <Column>
      <ScreenHeader backHref={backHref} title={t("header")} />
      <div className="flex flex-col gap-1">
        <h2 className="text-[22px] leading-tight font-semibold text-ink">{t("title")}</h2>
        <p className="text-[15px] text-muted">
          {t("intro", { n: total, count: formatCount(total, formats) })}
        </p>
      </div>
      {refusal ? (
        <RefusalNotice refusal={refusal} tooMany={busy} sourceNames={sourceNamesOf(preview)} />
      ) : null}
      {SECTIONS.map((section) => {
        const items = preview.accounts.filter((a) => a.suggested === section);
        if (items.length === 0) return null;
        return (
          <section key={section} aria-labelledby={`section-${section}`} className="flex flex-col">
            <h3 id={`section-${section}`} className="text-[13px] font-medium text-muted">
              {t(`sections.${section}`, { count: formatCount(items.length, formats) })}
            </h3>
            <ul className="flex flex-col">
              {items.map((item) => (
                <li
                  key={item.sourceId}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"
                >
                  <div className="flex min-w-0 flex-1 basis-32 flex-col">
                    <p className="text-[15px] font-medium [overflow-wrap:anywhere] text-ink">{item.name}</p>
                    <Summary item={item} formats={formats} />
                  </div>
                  <KindChoice item={item} disabled={pending} onChoose={(kind) => choose(item, kind)} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <Pinned>
        <Button size="lg" asChild>
          <Link href={backHref}>{t("done")}</Link>
        </Button>
      </Pinned>
    </Column>
  );
}
