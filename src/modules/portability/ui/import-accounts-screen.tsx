"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AmountText, Button, ChoiceGroup, Icon, ScreenHeader, Sheet } from "@/shared/ui";
import type { AccountDto } from "@/shared/ui/api/dto";
import { formatCount } from "@/shared/ui/format/count";
import { formatMoney } from "@/shared/ui/format/formatters";
import type { AccountMappingDto, ImportAccountDto, ImportPreviewDto } from "./dto";
import { Column, Pinned, RefusalNotice, type ScreenFormats } from "./parts";
import { useAdjust, type DraftPlace } from "./use-adjust";

type AccountType = Extract<AccountMappingDto, { kind: "new" }>["type"];

const TYPES: readonly AccountType[] = [
  "BANK",
  "CREDIT_CARD",
  "SAVINGS",
  "CASH",
  "WALLET",
  "INVESTMENT",
  "LOAN",
  "OTHER",
];

/** Until the person widens the list, the board shows this many accounts and "y N cuentas más". */
const FIRST = 4;

/** An account of the person's that a source account can go to: live, and in the source account's currency. */
const candidatesFor = (source: ImportAccountDto, accounts: readonly AccountDto[]) =>
  accounts.filter(
    (a) => a.archivedAt === null && a.type !== "SHARED_FUND" && a.balance.currency === source.currency,
  );

/** What a source account goes to, as its card names it. */
function MappingText({
  source,
  accounts,
}: {
  readonly source: ImportAccountDto;
  readonly accounts: readonly AccountDto[];
}) {
  const t = useTranslations("portability.accounts");
  const { mapping } = source;
  if (mapping.kind === "existing") {
    const target = accounts.find((a) => a.id === mapping.accountId);
    return (
      <>
        <span className="text-[15px] font-medium text-ink">
          {t("use", { name: target?.name ?? source.name })}
        </span>
        {target && target.type !== "SHARED_FUND" ? (
          <span className="text-[13px] text-muted">{t("yours", { type: t(`types.${target.type}`) })}</span>
        ) : null}
      </>
    );
  }
  const card =
    mapping.type === "CREDIT_CARD" && source.cutOffDay !== null && source.paymentDay !== null
      ? t("card", { currency: source.currency, cutOff: source.cutOffDay, payment: source.paymentDay })
      : source.currency;
  return (
    <>
      <span className="text-[15px] font-medium text-ink">
        {t("new", { type: t(`types.${mapping.type}`) })}
      </span>
      <span className="text-[13px] text-muted">{card}</span>
    </>
  );
}

/** One source account's choice: an account of the person's in its currency, or a new one of a type. */
function AccountSheet({
  source,
  accounts,
  onClose,
  draft,
}: {
  readonly source: ImportAccountDto;
  readonly accounts: readonly AccountDto[];
  readonly onClose: () => void;
  readonly draft: DraftPlace;
}) {
  const t = useTranslations("portability.accounts");
  const busy = useTranslations("portability")("busy");
  const candidates = candidatesFor(source, accounts);
  const [choice, setChoice] = useState(source.mapping.kind === "existing" ? source.mapping.accountId : "new");
  const [type, setType] = useState<AccountType>(
    source.mapping.kind === "new" ? source.mapping.type : source.type,
  );
  const { adjust, pending, refusal } = useAdjust(draft);
  const save = async () => {
    const mapping: AccountMappingDto =
      choice === "new"
        ? { kind: "new", type, currency: source.currency }
        : { kind: "existing", accountId: choice };
    if (await adjust({ accounts: { [source.sourceId]: mapping } })) onClose();
  };
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={source.name}
      footer={
        <Button size="lg" disabled={pending} onClick={() => void save()}>
          {t("save")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <ChoiceGroup
          label={t("sheetChoice")}
          layout="list"
          value={choice}
          options={[
            { value: "new", label: t("createNew") },
            ...candidates.map((a) => ({
              value: a.id,
              label: t("use", { name: a.name }),
              description: a.type === "SHARED_FUND" ? undefined : t("yours", { type: t(`types.${a.type}`) }),
            })),
          ]}
          onValueChange={setChoice}
        />
        {candidates.length === 0 ? (
          <p className="text-sm text-muted">{t("noExisting", { currency: source.currency })}</p>
        ) : null}
        {choice === "new" ? (
          <>
            <ChoiceGroup
              label={t("type")}
              layout="chips"
              value={type}
              options={TYPES.map((value) => ({ value, label: t(`types.${value}`) }))}
              onValueChange={setType}
            />
            <p className="text-sm text-muted">{t("currency", { currency: source.currency })}</p>
          </>
        ) : null}
        {refusal ? <RefusalNotice refusal={refusal} tooMany={busy} /> : null}
      </div>
    </Sheet>
  );
}

/**
 * D28, board "4 · Importar · cuentas": each account of the file, under its name and the type it was given, goes to an
 * account of the person's or to a new one; tapping its card opens the choice. A mapped account keeps the file's
 * currency (the API refuses any other, design §3.2), so the sheet offers only accounts in it and names it for a new
 * one. Under each card, the account's closing balance in the file.
 */
export function ImportAccountsScreen({
  backHref,
  preview,
  accounts,
  formats,
  draft,
}: {
  readonly backHref: string;
  readonly preview: ImportPreviewDto;
  /** The person's accounts in their personal space. */
  readonly accounts: readonly AccountDto[];
  readonly formats: ScreenFormats;
  readonly draft: DraftPlace;
}) {
  const t = useTranslations("portability.accounts");
  const [editing, setEditing] = useState<string | null>(null);
  const [all, setAll] = useState(preview.accounts.length <= FIRST + 1);
  const shown = all ? preview.accounts : preview.accounts.slice(0, FIRST);
  const rest = preview.accounts.length - shown.length;
  const source = preview.accounts.find((a) => a.sourceId === editing);
  return (
    <Column>
      <ScreenHeader backHref={backHref} title={t("title")} />
      <p className="text-[15px] text-muted">{t("intro")}</p>
      <ul className="flex flex-col divide-y divide-line">
        {shown.map((item) => (
          <li key={item.sourceId} className="flex flex-col gap-2 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <h2 className="min-w-0 text-[15px] font-medium [overflow-wrap:anywhere] text-ink">
                {item.name}
              </h2>
              <span className="text-[13px] text-muted">{t(`types.${item.type}`)}</span>
            </div>
            <button
              type="button"
              onClick={() => setEditing(item.sourceId)}
              aria-label={`${item.name}: ${t("sheetChoice")}`}
              className={`flex min-h-14 w-full items-center gap-3 rounded-[14px] border border-line p-3 text-left ${item.mapping.kind === "new" ? "bg-accent-soft" : "bg-surface"}`}
            >
              <Icon
                name={item.mapping.kind === "new" ? "plus" : "check"}
                size={20}
                className="shrink-0 text-accent"
              />
              <span className="flex min-w-0 flex-1 flex-col [overflow-wrap:anywhere]">
                <MappingText source={item} accounts={accounts} />
              </span>
              <Icon name="chevronDown" size={20} className="shrink-0 text-muted" />
            </button>
            <p className="text-[13px] text-muted">
              <AmountText text={t("balance", { balance: formatMoney(item.sourceClosingBalance, formats) })} />
            </p>
          </li>
        ))}
      </ul>
      {rest > 0 ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="min-h-11 self-start text-[15px] font-semibold text-accent"
        >
          {t("more", { n: rest, count: formatCount(rest, formats) })}
        </button>
      ) : null}
      {source ? (
        <AccountSheet source={source} accounts={accounts} onClose={() => setEditing(null)} draft={draft} />
      ) : null}
      <Pinned>
        <Button size="lg" asChild>
          <Link href={backHref}>{t("done")}</Link>
        </Button>
      </Pinned>
    </Column>
  );
}
