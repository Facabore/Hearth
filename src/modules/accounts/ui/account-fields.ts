import type { Problem } from "@/shared/ui/api/problem";
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import type { NumberFormat } from "@/shared/ui/format/formatters";
import type { AccountType } from "./account-look";

/** The NewAccount artboard's types, in its order (a shared fund only in a shared space). */
export const PERSONAL_TYPES = [
  "BANK",
  "WALLET",
  "CASH",
  "CREDIT_CARD",
  "SAVINGS",
  "INVESTMENT",
  "LOAN",
  "OTHER",
] as const satisfies readonly AccountType[];

export type AccountField =
  | "institution"
  | "lastFour"
  | "creditLimit"
  | "cutOffDay"
  | "paymentDay"
  | "monthlyRate"
  | "annualRate"
  | "termDays"
  | "maturityDate"
  | "principal"
  | "termMonths";

/**
 * HU-E2-06: the attributes the form asks per type, within the API's allow-list (ruling P131). Issue #164: a wallet is
 * not asked for Last 4 (Nequi and Daviplata go by phone, not by four digits); the API still takes it, and a wallet
 * that has one still shows it.
 */
export const FIELDS_BY_TYPE: Readonly<Record<AccountType, readonly AccountField[]>> = {
  BANK: ["institution", "lastFour"],
  WALLET: ["institution"],
  CASH: [],
  CREDIT_CARD: ["institution", "lastFour", "creditLimit", "cutOffDay", "paymentDay", "monthlyRate"],
  SAVINGS: ["institution", "lastFour", "annualRate", "termDays", "maturityDate"],
  INVESTMENT: ["institution"],
  OTHER: ["institution"],
  SHARED_FUND: ["institution"],
  LOAN: ["institution", "principal", "annualRate", "termMonths"],
};

/** A card's or a loan's opening balance is asked as what is owed today and sent negative. */
export const OWED_TYPES: readonly AccountType[] = ["CREDIT_CARD", "LOAN"];

const AVAILABLE_BY_DEFAULT: readonly AccountType[] = ["CASH", "BANK", "WALLET", "SHARED_FUND"];
/** The switches' starting positions: the API's defaults (`switchesOf`, P51), pinned by a test. */
export const SWITCH_DEFAULTS = Object.fromEntries(
  (
    [
      "CASH",
      "BANK",
      "WALLET",
      "CREDIT_CARD",
      "SAVINGS",
      "INVESTMENT",
      "LOAN",
      "OTHER",
      "SHARED_FUND",
    ] as const
  ).map((type) => [
    type,
    { includeInAvailable: AVAILABLE_BY_DEFAULT.includes(type), includeInNetWorth: true },
  ]),
) as Readonly<Record<AccountType, { includeInAvailable: boolean; includeInNetWorth: boolean }>>;

export interface AccountDraft {
  readonly type: AccountType;
  readonly name: string;
  readonly opening: string;
  readonly fields: Readonly<Partial<Record<AccountField, string>>>;
  readonly includeInAvailable: boolean | null;
  readonly includeInNetWorth: boolean | null;
}

const MONEY_TERMS: readonly AccountField[] = ["creditLimit", "principal"];
const INTEGER_TERMS: readonly AccountField[] = ["cutOffDay", "paymentDay", "termDays", "termMonths"];
const RATE_TERMS: readonly AccountField[] = ["monthlyRate", "annualRate"];

/** The create body, or the field whose text cannot be read; a switch left alone is not sent (P51). */
export const accountBodyOf = (
  draft: AccountDraft,
  currency: string,
  numberFormat: NumberFormat,
): { ok: true; body: Record<string, unknown> } | { ok: false; field: "opening" | AccountField } => {
  const { exponent } = currencyOf(currency);
  const money = (text: string) => {
    const decimal = parseDecimal(text, numberFormat);
    const minor = decimal === null ? null : minorOf(decimal, exponent);
    return minor === null ? null : { amount: minor, currency };
  };
  // Issue #178: an opening balance left empty is 0, not a required field.
  const opening = money(draft.opening.trim() === "" ? "0" : draft.opening);
  if (!opening) return { ok: false, field: "opening" };
  const owed = OWED_TYPES.includes(draft.type) && opening.amount !== "0";
  const body: Record<string, unknown> = {
    name: draft.name.trim(),
    type: draft.type,
    openingBalance: owed ? { ...opening, amount: `-${opening.amount}` } : opening,
  };
  const terms: Record<string, unknown> = {};
  for (const field of FIELDS_BY_TYPE[draft.type]) {
    const text = draft.fields[field]?.trim();
    if (!text) continue;
    if (field === "institution" || field === "lastFour") body[field] = text;
    else if (MONEY_TERMS.includes(field)) {
      const value = money(text);
      if (!value) return { ok: false, field };
      terms[field] = value;
    } else if (INTEGER_TERMS.includes(field)) {
      if (!/^\d+$/.test(text)) return { ok: false, field };
      terms[field] = Number(text);
    } else if (RATE_TERMS.includes(field)) {
      const rate = parseDecimal(text, numberFormat);
      if (rate === null) return { ok: false, field };
      terms[field] = rate;
    } else terms[field] = text;
  }
  if (Object.keys(terms).length > 0) body.terms = terms;
  if (draft.includeInAvailable !== null) body.includeInAvailable = draft.includeInAvailable;
  if (draft.includeInNetWorth !== null) body.includeInNetWorth = draft.includeInNetWorth;
  return { ok: true, body };
};

const ALL_FIELDS: readonly AccountField[] = Object.values(FIELDS_BY_TYPE).flat();
const BY_CODE: Readonly<Record<string, "name" | "opening" | AccountField>> = {
  AccountNameTaken: "name",
  InvalidAccountName: "name",
  InvalidAmount: "opening",
  CurrencyMismatch: "opening",
  InvalidCreditLimit: "creditLimit",
  InvalidTermDeposit: "termDays",
  InvalidTerm: "termMonths",
};

/** Ruling P118: where an API problem is shown on the form. */
export const accountFieldOf = (problem: Problem): "name" | "opening" | AccountField | "form" => {
  const byCode = BY_CODE[problem.code];
  if (byCode) return byCode;
  if (problem.code === "AccountAttributeNotAllowed")
    return ALL_FIELDS.includes(problem.field as AccountField) ? (problem.field as AccountField) : "form";
  if (problem.code === "ValidationFailed") {
    const last = problem.errors[0]?.path.split(".").at(-1);
    if (last === "name") return "name";
    if (ALL_FIELDS.includes(last as AccountField)) return last as AccountField;
  }
  return "form";
};
