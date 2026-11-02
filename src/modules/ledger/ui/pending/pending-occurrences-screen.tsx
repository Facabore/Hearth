"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge, Button, Icon, NumberField, ProblemNotice, ScreenHeader } from "@/shared/ui";
import type { MoneyDto, SpaceDto } from "@/shared/ui/api/dto";
import type { Problem } from "@/shared/ui/api/problem";
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import {
  decimalOf,
  formatDate,
  formatMoney,
  formatNumber,
  type Formats,
} from "@/shared/ui/format/formatters";
import { useToast } from "@/shared/ui/molecules/toast";
import { withTx } from "../detail/tx-href";
import { hrefOf } from "../list-href";
import { useIdempotencyKey } from "../record/use-idempotency-key";

/** A pending occurrence as the screen shows it: the API's own fields, with its payer and account named. */
export interface PendingItem {
  readonly id: string;
  readonly recurrenceId: string;
  readonly name: string;
  readonly type: "EXPENSE" | "INCOME" | "TRANSFER" | "FUND_CONTRIBUTION";
  readonly date: string;
  readonly suggested: MoneyDto;
  /** Who pays and from which account, when the screen knows their names. */
  readonly details: readonly string[];
}

export type ConfirmOutcome =
  { readonly ok: true; readonly transactionId: string } | { readonly ok: false; readonly problem: Problem };

/** `next` is the recurrence's next occurrence as the API answers it, null once it has none. */
export type SkipOutcome =
  { readonly ok: true; readonly next: string | null } | { readonly ok: false; readonly problem: Problem };

type ScreenFormats = Pick<Formats, "numberFormat" | "dateFormat">;

/**
 * HU-E9-09 (ruling P270), "Por confirmar": the space's pending occurrences, each with its date, the suggested amount
 * and payer, a field for the real amount and the difference from the suggestion in words. Confirming toasts the
 * movement with "Ver" and skipping toasts the next date the API gives; either takes the item away at once. A VIEWER
 * reads them with the role note and no field or action (S6). It fetches nothing: the route hands it the items and
 * the writes.
 */
export function PendingOccurrencesScreen({
  space,
  items,
  formats,
  canAct,
  onConfirm,
  onSkip,
}: {
  readonly space: SpaceDto;
  readonly items: readonly PendingItem[];
  readonly formats: ScreenFormats;
  readonly canAct: boolean;
  readonly onConfirm: (
    item: PendingItem,
    amount: MoneyDto,
    idempotencyKey: string,
  ) => Promise<ConfirmOutcome>;
  readonly onSkip: (item: PendingItem) => Promise<SkipOutcome>;
}) {
  const t = useTranslations("recurrences");
  const router = useRouter();
  const toast = useToast();
  // An item leaves as soon as the API accepts it; the list's next read no longer has it either.
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set());
  const shown = items.filter((item) => !done.has(item.id));
  const finish = (id: string) => setDone((before) => new Set(before).add(id));
  return (
    <div className="mx-auto flex w-full max-w-[560px] min-w-0 flex-col gap-3 py-3">
      <ScreenHeader
        backHref={`/spaces/${space.id}/transactions`}
        title={t("pending.title")}
        subtitle={t("pending.subtitle", { space: space.name, count: shown.length })}
      />
      {canAct ? null : (
        <p className="flex gap-2 rounded-2xl bg-track p-3 text-sm text-ink">
          <Icon name="lock" size={18} />
          <span>{t("viewer.pending", { space: space.name })}</span>
        </p>
      )}
      {shown.length === 0 ? <p className="text-muted">{t("pending.empty")}</p> : null}
      {shown.map((item) => (
        <PendingCard
          key={item.id}
          item={item}
          formats={formats}
          canAct={canAct}
          onConfirm={async (amount, key) => {
            const outcome = await onConfirm(item, amount, key);
            if (!outcome.ok) return outcome.problem;
            finish(item.id);
            toast.show({
              message: t(`pending.saved.${item.type}`),
              action: {
                label: t("pending.view"),
                onAction: () => router.push(withTx(hrefOf(space.id, {}), outcome.transactionId)),
              },
            });
            return null;
          }}
          onSkip={async () => {
            const outcome = await onSkip(item);
            if (!outcome.ok) return outcome.problem;
            finish(item.id);
            toast.show({
              message:
                outcome.next === null
                  ? t("pending.skippedLast", { name: item.name })
                  : t("pending.skipped", { name: item.name, date: formatDate(outcome.next, formats) }),
            });
            return null;
          }}
        />
      ))}
      {canAct && shown.length > 0 ? <p className="text-sm text-muted">{t("pending.note")}</p> : null}
    </div>
  );
}

/** The amount typed, in minor units, or null when it is not a positive amount of the currency. */
const minorTyped = (text: string, currency: string, formats: ScreenFormats): string | null => {
  const decimal = parseDecimal(text, formats.numberFormat);
  const minor = decimal === null ? null : minorOf(decimal, currencyOf(currency).exponent);
  return minor !== null && BigInt(minor) > 0n ? minor : null;
};

function PendingCard({
  item,
  formats,
  canAct,
  onConfirm,
  onSkip,
}: {
  readonly item: PendingItem;
  readonly formats: ScreenFormats;
  readonly canAct: boolean;
  readonly onConfirm: (amount: MoneyDto, idempotencyKey: string) => Promise<Problem | null>;
  readonly onSkip: () => Promise<Problem | null>;
}) {
  const t = useTranslations("recurrences.pending");
  const { currency } = item.suggested;
  const { symbol, exponent } = currencyOf(currency);
  const [amount, setAmount] = useState(() =>
    formatNumber(decimalOf(item.suggested.amount, exponent), formats),
  );
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const minor = minorTyped(amount, currency, formats);
  // HU-E0-10 (P128): one key per amount, so a retry of the same confirmation is the same request.
  const { key } = useIdempotencyKey(`${item.id}:${minor ?? ""}`);
  const difference = minor === null ? 0n : BigInt(minor) - BigInt(item.suggested.amount);
  const differenceText =
    difference === 0n
      ? undefined
      : t(difference > 0n ? "more" : "less", {
          amount: formatMoney(
            { amount: String(difference < 0n ? -difference : difference), currency },
            formats,
          ),
        });
  const run = async (write: () => Promise<Problem | null>) => {
    setBusy(true);
    setProblem(null);
    const refused = await write();
    // An accepted write unmounts the card; only a refusal is left to show.
    if (refused) {
      setProblem(refused);
      setBusy(false);
    }
  };
  const titleId = `pending-${item.id}`;
  return (
    <article
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3"
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 id={titleId} className="font-semibold [overflow-wrap:anywhere] text-ink">
            {item.name}
          </h2>
          <p className="text-sm text-muted">{t("since", { date: formatDate(item.date, formats) })}</p>
        </div>
        <Badge>{t(`type.${item.type}`)}</Badge>
      </div>
      <p className="text-sm [overflow-wrap:anywhere] text-muted">
        {[t("suggested", { amount: formatMoney(item.suggested, formats) }), ...item.details].join(" · ")}
      </p>
      {canAct ? (
        <>
          <NumberField
            id={`pending-amount-${item.id}`}
            label={t("realAmount", { name: item.name })}
            kind="money"
            numberFormat={formats.numberFormat}
            decimals={exponent}
            symbol={symbol}
            example={false}
            value={amount}
            onChange={(value) => {
              setAmount(value);
              setInvalid(false);
            }}
            hint={differenceText}
            error={invalid ? t("invalidAmount") : undefined}
          />
          {problem ? <ProblemNotice problem={problem} /> : null}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => void run(onSkip)}>
              {t("skip")}
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                if (minor === null) setInvalid(true);
                else void run(() => onConfirm({ amount: minor, currency }, key));
              }}
            >
              {t("confirm")}
            </Button>
          </div>
        </>
      ) : null}
    </article>
  );
}
