import type { components } from "@/shared/ui/api/schema";
import type { Problem } from "@/shared/ui/api/problem";
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import type { NumberFormat } from "@/shared/ui/format/formatters";
import { sharedPartsOf, type SplitDraft } from "../split/split-request";

export type RecurrenceDto = components["schemas"]["Recurrence"];
export type RecurrenceType = RecurrenceDto["type"];
export type Schedule = RecurrenceDto["schedule"];
export type RecurrenceMode = RecurrenceDto["mode"];

/** The schedule as the form holds it: both kinds' days, so switching back keeps what was chosen. */
export interface ScheduleDraft {
  readonly kind: Schedule["kind"];
  readonly day: number;
  readonly day1: number;
  readonly day2: number;
}

export interface RecurrenceDraft {
  readonly type: RecurrenceType;
  readonly amount: string;
  readonly description: string;
  readonly category: { readonly categoryId: string; readonly subcategoryId?: string | null } | null;
  /** An expense's or a contribution's account, an income's receiving account, a transfer's source. */
  readonly accountId: string | null;
  /** A transfer's destination. */
  readonly toAccountId: string | null;
  /** A contribution's fund. */
  readonly fundId: string | null;
  readonly schedule: ScheduleDraft;
  readonly mode: RecurrenceMode;
  readonly startDate: string;
  readonly endDate: string | null;
}

export type RecurrenceField =
  "amount" | "description" | "category" | "account" | "toAccount" | "fund" | "payer" | "split" | "dates";

export type Built =
  | { readonly ok: true; readonly body: Record<string, unknown> }
  | { readonly ok: false; readonly field: RecurrenceField; readonly reason?: "exactSplit" };

/** Ruling P24: the days run from 1 to 31; a shorter month records on its last day. */
export const MAX_DAY = 31;

export const scheduleOf = (draft: ScheduleDraft): Schedule =>
  draft.kind === "MONTHLY"
    ? { kind: "MONTHLY", day: draft.day }
    : { kind: "SEMI_MONTHLY", day1: draft.day1, day2: draft.day2 };

/** The form's schedule for a stored one: the other kind's days start where the story's examples do (1; 15 and 30). */
export const scheduleDraftOf = (schedule: Schedule): ScheduleDraft =>
  schedule.kind === "MONTHLY"
    ? { kind: "MONTHLY", day: schedule.day, day1: 15, day2: 30 }
    : { kind: "SEMI_MONTHLY", day: schedule.day1, day1: schedule.day1, day2: schedule.day2 };

/** A day moved by the − and + buttons, kept within 1 to 31. */
export const stepDay = (day: number, step: 1 | -1): number => Math.min(MAX_DAY, Math.max(1, day + step));

const categoryOf = (draft: RecurrenceDraft) =>
  draft.category ? (draft.category.subcategoryId ?? draft.category.categoryId) : null;

/**
 * Ruling P23: a shared expense's payer and split for a recurrence. A split nobody chose, or the plan's, is left to
 * each occurrence (no `split`: BY_ALLOCATION with the plan of its period, else EQUAL); exact amounts are not offered.
 */
const sharedExpenseOf = (
  split: SplitDraft,
  input: {
    readonly amount: string;
    readonly currency: string;
    readonly numberFormat: NumberFormat;
    readonly memberIds: readonly string[];
  },
):
  | Extract<Built, { ok: false }>
  | { ok: true; payer: Record<string, unknown>; split: Record<string, unknown> | null } => {
  const chosen = split.chosen && split.method !== "BY_ALLOCATION";
  if (chosen && split.method === "EXACT") return { ok: false, field: "split", reason: "exactSplit" };
  const parts = sharedPartsOf(chosen ? split : { ...split, method: "BY_ALLOCATION" }, input);
  if (!parts.ok) return { ok: false, field: parts.field };
  // A recurrence is never paid for the fund: its payer sheet does not offer it (D26).
  if (parts.payments === null) return { ok: false, field: "payer" };
  const paid = parts.payments[0]!;
  return {
    ok: true,
    payer: { memberId: paid.memberId, accountId: paid.accountId },
    split: parts.split,
  };
};

/**
 * HU-E9-09: the body of `POST …/recurrences` (RecurrenceDefinition). As the record form does (P118), the form checks only
 * what it needs to build it: an amount it can read and the accounts; the API validates the rest.
 */
export const definitionOf = (
  draft: RecurrenceDraft,
  input: {
    readonly currency: string;
    readonly numberFormat: NumberFormat;
    /** The definer's member id, who pays a personal expense. */
    readonly meMemberId: string;
    /** A shared or direct space's expense: who pays and how it is split (HU-E9-06). */
    readonly shared?: { readonly split: SplitDraft; readonly memberIds: readonly string[] } | undefined;
  },
): Built => {
  const decimal = parseDecimal(draft.amount, input.numberFormat);
  const minor = decimal === null ? null : minorOf(decimal, currencyOf(input.currency).exponent);
  if (minor === null) return { ok: false, field: "amount" };
  const categoryId = categoryOf(draft);
  let template: Record<string, unknown>;
  switch (draft.type) {
    case "EXPENSE": {
      if (!categoryId) return { ok: false, field: "category" };
      if (input.shared) {
        const built = sharedExpenseOf(input.shared.split, {
          amount: minor,
          currency: input.currency,
          numberFormat: input.numberFormat,
          memberIds: input.shared.memberIds,
        });
        if (!built.ok) return built;
        template = {
          type: "EXPENSE",
          categoryId,
          payer: built.payer,
          ...(built.split ? { split: built.split } : {}),
        };
      } else {
        if (!draft.accountId) return { ok: false, field: "account" };
        template = {
          type: "EXPENSE",
          categoryId,
          payer: { memberId: input.meMemberId, accountId: draft.accountId },
        };
      }
      break;
    }
    case "INCOME":
      if (!categoryId) return { ok: false, field: "category" };
      if (!draft.accountId) return { ok: false, field: "account" };
      template = { type: "INCOME", categoryId, accountId: draft.accountId };
      break;
    case "TRANSFER":
      if (!draft.accountId) return { ok: false, field: "account" };
      if (!draft.toAccountId) return { ok: false, field: "toAccount" };
      template = {
        type: "TRANSFER",
        sourceAccountId: draft.accountId,
        destinationAccountId: draft.toAccountId,
      };
      break;
    case "FUND_CONTRIBUTION":
      if (!draft.fundId) return { ok: false, field: "fund" };
      if (!draft.accountId) return { ok: false, field: "account" };
      template = { type: "FUND_CONTRIBUTION", fundAccountId: draft.fundId, sourceAccountId: draft.accountId };
      break;
  }
  return {
    ok: true,
    body: {
      description: draft.description.trim(),
      amount: { amount: minor, currency: input.currency },
      template,
      schedule: scheduleOf(draft.schedule),
      mode: draft.mode,
      startDate: draft.startDate,
      ...(draft.endDate ? { endDate: draft.endDate } : {}),
    },
  };
};

/**
 * The body of `PATCH …/recurrences/{id}`: what an edit may change (its description, amount, category, schedule, mode
 * and end date). The type, the payer, the accounts, the split and the start stay as they were defined.
 */
export const changesOf = (
  draft: RecurrenceDraft,
  input: { readonly currency: string; readonly numberFormat: NumberFormat },
): Built => {
  const decimal = parseDecimal(draft.amount, input.numberFormat);
  const minor = decimal === null ? null : minorOf(decimal, currencyOf(input.currency).exponent);
  if (minor === null) return { ok: false, field: "amount" };
  const categoryId = categoryOf(draft);
  const categorized = draft.type === "EXPENSE" || draft.type === "INCOME";
  if (categorized && !categoryId) return { ok: false, field: "category" };
  return {
    ok: true,
    body: {
      description: draft.description.trim(),
      amount: { amount: minor, currency: input.currency },
      ...(categorized ? { categoryId } : {}),
      schedule: scheduleOf(draft.schedule),
      mode: draft.mode,
      endDate: draft.endDate,
    },
  };
};

/**
 * The codes `POST …/recurrences` and `PATCH …/recurrences/{id}` answer for one field (their 4xx descriptions). A
 * recurrence's own map, not the record form's: its paths sit under `template`, and its dates are a schedule's.
 */
const BY_CODE: Readonly<Record<string, RecurrenceField>> = {
  InvalidAmount: "amount",
  CurrencyMismatch: "amount",
  UnknownCurrency: "amount",
  InvalidDescription: "description",
  CategoryNotFound: "category",
  CategoryArchived: "category",
  AccountNotFound: "account",
  AccountArchived: "account",
  AccountNotOwned: "account",
  AccountNotInSpace: "account",
  AccountRequired: "account",
  SameAccountTransfer: "toAccount",
  InvalidFundAccount: "payer",
  GuestHasNoAccounts: "payer",
  InvalidSplit: "split",
  ParticipantsRequired: "split",
  NotASpaceMember: "split",
  InvalidRecurrence: "dates",
  InvalidPeriodPolicy: "dates",
  InvalidDate: "dates",
};
const BY_PATH: readonly (readonly [RegExp, RecurrenceField])[] = [
  [/^amount/, "amount"],
  [/^description/, "description"],
  [/^template\.categoryId/, "category"],
  [/^template\.payer/, "payer"],
  [/^template\.split/, "split"],
  [/^template\.(accountId|sourceAccountId)/, "account"],
  [/^template\.destinationAccountId/, "toAccount"],
  [/^template\.fundAccountId/, "fund"],
  [/^(schedule|startDate|endDate)/, "dates"],
];

/** Where an API problem about a recurrence is shown: next to its field, else above the button. */
export const recurrenceFieldOf = (problem: Problem): RecurrenceField | "form" => {
  const byCode = BY_CODE[problem.code];
  if (byCode) return byCode;
  if (problem.code === "ValidationFailed") {
    const path = problem.errors[0]?.path ?? "";
    const found = BY_PATH.find(([pattern]) => pattern.test(path));
    if (found) return found[1];
  }
  return "form";
};
