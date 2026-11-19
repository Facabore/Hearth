"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { Icon, NumberField } from "@/shared/ui";
import type { SpaceMemberDto } from "@/shared/ui/api/dto";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { AmountText } from "@/shared/ui/atoms/amount";
import { currencyOf } from "@/shared/ui/format/currencies";
import { formatMoney, formatNumber, type Formats } from "@/shared/ui/format/formatters";
import type { AllocationRule, Preview } from "./allocation";

/** One of a line's other currencies: what the rule assigns in it, and its FIXED values as typed. */
export interface OtherCurrency {
  readonly currency: string;
  readonly preview: Preview;
  readonly values: Readonly<Record<string, string>>;
}

/**
 * Ruling P342 (S7, "Misma regla, por moneda"): the line's rule in each of its other currencies, under the allocation
 * of its first. A FIXED line takes each member's amount in that currency, which add up to its budget there; any other
 * rule says what each member is assigned in it ("En USD: Ana 0 USD · Juan 100 USD").
 */
export function OtherAllocations({
  rule,
  currencies,
  members,
  formats,
  onValues,
}: {
  readonly rule: AllocationRule;
  readonly currencies: readonly OtherCurrency[];
  readonly members: readonly SpaceMemberDto[];
  readonly formats: Formats;
  readonly onValues: (currency: string, values: Readonly<Record<string, string>>) => void;
}) {
  const t = useTranslations("budgeting.allocation");
  const messageOf = useProblemMessage();
  const ids = useId();
  if (rule === "NONE" || currencies.length === 0) return null;
  const money = (amount: string, currency: string) => formatMoney({ amount, currency }, formats);
  return currencies.map(({ currency, preview, values }) => {
    const assigned = preview.kind === "assigned" ? preview.amounts : null;
    if (rule !== "FIXED")
      return (
        <p key={currency} className="text-sm [overflow-wrap:anywhere] text-ink">
          <AmountText
            text={
              assigned === null
                ? t("noCapacityIn", { currency })
                : t("inCurrency", {
                    currency,
                    amounts: members
                      .map((member) => `${member.displayName} ${money(assigned[member.id] ?? "0", currency)}`)
                      .join(" · "),
                  })
            }
          />
        </p>
      );
    return (
      <section key={currency} aria-labelledby={`${ids}-${currency}`} className="flex flex-col gap-2">
        <h3 id={`${ids}-${currency}`} className="text-sm font-semibold text-ink">
          {t("inCurrencyHeading", { currency })}
        </h3>
        {members.map((member) => (
          <NumberField
            key={member.id}
            id={`${ids}-${currency}-${member.id}`}
            label={t("valueIn", { name: member.displayName, currency })}
            kind="money"
            numberFormat={formats.numberFormat}
            decimals={currencyOf(currency).exponent}
            currency={currency}
            example="300000"
            value={values[member.id] ?? ""}
            onChange={(value) => onValues(currency, { ...values, [member.id]: value })}
            error={
              preview.kind === "unreadable" && preview.memberId === member.id
                ? t("unreadable", { example: formatNumber("300000", formats) })
                : undefined
            }
          />
        ))}
        {preview.kind === "invalid" ? (
          <div role="alert" className="flex items-start gap-1.5 text-sm text-danger">
            <Icon name="alert" size={16} />
            <p>
              {
                messageOf({
                  code: "InvalidAllocation",
                  status: 422,
                  requestId: null,
                  errors: [],
                  field: null,
                }).message
              }{" "}
              {t("sum", { sum: money(preview.sum, currency) })}
            </p>
          </div>
        ) : null}
      </section>
    );
  });
}
