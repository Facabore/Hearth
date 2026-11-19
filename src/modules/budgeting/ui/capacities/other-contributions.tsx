"use client";

import { useTranslations } from "next-intl";
import { Button, Icon, NumberField } from "@/shared/ui";
import { HeroAmount } from "@/shared/ui/atoms/hero-amount";
import { currencyOf } from "@/shared/ui/format/currencies";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";
import type { OtherDraft } from "./capacity-draft";

/**
 * Ruling P342 (S7, "Juan 2.400.000 COP y 100 USD"): a member's contributions in other currencies than the space's,
 * each in its own field with a ✕ that clears it; read only, each stored amount. Loaded only for a member who has one
 * (ADR 0004).
 */
export function OtherContributions({
  idPrefix,
  name,
  editable,
  stored,
  drafts,
  formats,
  errorOf,
  onChange,
}: {
  readonly idPrefix: string;
  readonly name: string;
  readonly editable: boolean;
  readonly stored: readonly { readonly amount: string; readonly currency: string }[];
  readonly drafts: readonly OtherDraft[];
  readonly formats: Formats;
  readonly errorOf: (currency: string) => string | undefined;
  readonly onChange: (next: OtherDraft[]) => void;
}) {
  const t = useTranslations("budgeting.capacity");
  if (!editable)
    return stored.map((amount) => (
      <HeroAmount
        key={amount.currency}
        amount={formatMoney(amount, formats)}
        size="1.5rem"
        className="leading-[1.333] font-semibold text-ink"
      />
    ));
  return (
    <>
      {drafts.map((draft) => (
        <div key={draft.currency} className="flex items-start gap-2">
          <div className="min-w-0 flex-1 [&_label]:sr-only">
            <NumberField
              id={`${idPrefix}-${draft.currency}`}
              label={t("fieldIn", { name, currency: draft.currency })}
              kind="money"
              numberFormat={formats.numberFormat}
              decimals={currencyOf(draft.currency).exponent}
              currency={draft.currency}
              example={false}
              large
              value={draft.text}
              onChange={(text) =>
                onChange(drafts.map((one) => (one.currency === draft.currency ? { ...one, text } : one)))
              }
              error={errorOf(draft.currency)}
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="mt-1.5 shrink-0"
            aria-label={t("removeCurrency", { name, currency: draft.currency })}
            onClick={() => onChange(drafts.filter((one) => one.currency !== draft.currency))}
          >
            <Icon name="close" size={20} />
          </Button>
        </div>
      ))}
    </>
  );
}
