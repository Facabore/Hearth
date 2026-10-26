"use client";

import { useTranslations } from "next-intl";
import { NumberField, TextField } from "@/shared/ui";
import { currencyOf } from "@/shared/ui/format/currencies";
import type { Formats } from "@/shared/ui/format/formatters";
import type { NumberRule } from "@/shared/ui/format/number-input";
import { FIELDS_BY_TYPE, type AccountField } from "./account-fields";
import type { AccountType } from "./account-look";

/** Issue #164: how each number attribute is typed, and the example under it (as a decimal) when the kind's is not apt. */
const NUMBER_FIELDS: Partial<
  Record<AccountField, Omit<NumberRule, "numberFormat"> & { example?: string; unit?: string }>
> = {
  lastFour: { kind: "digits", maxLength: 4 },
  creditLimit: { kind: "money" },
  principal: { kind: "money" },
  cutOffDay: { kind: "integer", maxLength: 2, example: "25" },
  paymentDay: { kind: "integer", maxLength: 2, example: "15" },
  termDays: { kind: "integer", example: "90" },
  termMonths: { kind: "integer", example: "36" },
  monthlyRate: { kind: "decimal", decimals: 4, example: "1.89", unit: "%" },
  annualRate: { kind: "decimal", decimals: 4, unit: "%" },
};

/** HU-E2-06, issue 169: the attributes a type asks for, on the create and the edit form alike. */
export function AccountAttributeFields({
  type,
  idPrefix,
  formats,
  currency: code,
  values,
  onChange,
  errorOf,
}: {
  readonly type: AccountType;
  readonly idPrefix: string;
  readonly formats: Formats;
  readonly currency: string;
  readonly values: Readonly<Partial<Record<AccountField, string>>>;
  readonly onChange: (field: AccountField, text: string) => void;
  readonly errorOf: (field: AccountField) => string | undefined;
}) {
  const t = useTranslations("accounts");
  const currency = currencyOf(code);
  return FIELDS_BY_TYPE[type].map((field) => {
    const number = NUMBER_FIELDS[field];
    return number ? (
      <NumberField
        key={field}
        id={`${idPrefix}-${field}`}
        label={t(`field.${field}`)}
        {...number}
        numberFormat={formats.numberFormat}
        decimals={number.kind === "money" ? currency.exponent : number.decimals}
        symbol={number.kind === "money" ? currency.symbol : undefined}
        hint={field === "lastFour" ? t("field.lastFourHint") : undefined}
        value={values[field] ?? ""}
        onChange={(next) => onChange(field, next)}
        error={errorOf(field)}
      />
    ) : (
      <TextField
        key={field}
        id={`${idPrefix}-${field}`}
        label={t(`field.${field}`)}
        type={field === "maturityDate" ? "date" : "text"}
        value={values[field] ?? ""}
        onChange={(event) => onChange(field, event.target.value)}
        error={errorOf(field)}
      />
    );
  });
}
