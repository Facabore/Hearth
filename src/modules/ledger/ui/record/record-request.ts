import type { Problem } from "@/shared/ui/api/problem";
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import type { NumberFormat } from "@/shared/ui/format/formatters";
import { occurredAtOf } from "@/shared/ui/time/when";
import type { When } from "./when-label";

export type RecordKind = "EXPENSE" | "INCOME" | "TRANSFER";

export interface RecordDraft {
  readonly kind: RecordKind;
  readonly amount: string;
  readonly description: string;
  readonly category: { readonly categoryId: string; readonly subcategoryId: string | null } | null;
  readonly accountId: string | null;
  readonly toAccountId: string | null;
  readonly when: When;
  readonly timeZone: string;
}

export type RecordField = "amount" | "description" | "category" | "account" | "toAccount" | "when";

/**
 * Ruling P118: the form checks only what it needs to build a request (an amount it can read, the accounts); the API
 * validates the rest. The date always travels with its instant and the recorder's zone (HU-E9-03, P129).
 */
export const requestOf = (
  draft: RecordDraft,
  currency: string,
  numberFormat: NumberFormat,
):
  | { ok: true; kind: RecordKind; body: Record<string, unknown> }
  | { ok: false; field: "amount" | "account" | "toAccount" } => {
  const decimal = parseDecimal(draft.amount, numberFormat);
  const minor = decimal === null ? null : minorOf(decimal, currencyOf(currency).exponent);
  if (minor === null) return { ok: false, field: "amount" };
  if (!draft.accountId) return { ok: false, field: "account" };
  if (draft.kind === "TRANSFER" && !draft.toAccountId) return { ok: false, field: "toAccount" };
  const body: Record<string, unknown> = {};
  const description = draft.description.trim();
  if (description) body.description = description;
  body.date = draft.when.date;
  body.occurredAt = occurredAtOf(draft.when.date, draft.when.wall, draft.timeZone);
  body.timeZone = draft.timeZone;
  if (draft.kind !== "TRANSFER" && draft.category)
    body.categoryId = draft.category.subcategoryId ?? draft.category.categoryId;
  body.amount = { amount: minor, currency };
  if (draft.kind === "TRANSFER") {
    body.sourceAccountId = draft.accountId;
    body.destinationAccountId = draft.toAccountId;
  } else body.accountId = draft.accountId;
  return { ok: true, kind: draft.kind, body };
};

const BY_CODE: Readonly<Record<string, RecordField>> = {
  InvalidAmount: "amount",
  CurrencyMismatch: "amount",
  UnknownCurrency: "amount",
  CategoryRequired: "category",
  CategoryNotInSpace: "category",
  CategoryArchived: "category",
  AccountRequired: "account",
  AccountArchived: "account",
  AccountNotOwned: "account",
  AccountNotInSpace: "account",
  SameAccountTransfer: "toAccount",
  InvalidDescription: "description",
  InvalidDate: "when",
  DateTimeMismatch: "when",
  TimeRequired: "when",
  InvalidTimeZone: "when",
  PeriodClosed: "when",
};
const BY_PATH: Readonly<Record<string, RecordField>> = {
  amount: "amount",
  description: "description",
  categoryId: "category",
  accountId: "account",
  sourceAccountId: "account",
  destinationAccountId: "toAccount",
  date: "when",
  occurredAt: "when",
  timeZone: "when",
};

/** Where an API problem is shown: next to its field, else above the button. */
export const recordFieldOf = (problem: Problem): RecordField | "form" => {
  const byCode = BY_CODE[problem.code];
  if (byCode) return byCode;
  if (problem.code === "ValidationFailed") {
    const first = problem.errors[0]?.path.split(".")[0];
    if (first && BY_PATH[first]) return BY_PATH[first];
  }
  return "form";
};
