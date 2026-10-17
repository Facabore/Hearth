import {
  addDays,
  addMonths,
  daysInMonth,
  domainError,
  err,
  fromParts,
  ok,
  partsOf,
  type LocalDate,
  type Result,
} from "@/shared/kernel";
import type { AccountType } from "./account-type";
import { effectiveAnnualPpm, equivalentMonthlyPpm, MAX_RATE_PPM } from "./rate";

/** HU-E2-06: the terms of credit cards, savings and term deposits (CDT), and loans; money in minor units. */
export interface AccountTerms {
  readonly creditLimit: bigint | null;
  readonly cutOffDay: number | null;
  readonly paymentDay: number | null;
  /** % M.V., in parts per million. */
  readonly monthlyRatePpm: number | null;
  /** % E.A., in parts per million. */
  readonly annualRatePpm: number | null;
  readonly termDays: number | null;
  readonly maturityDate: LocalDate | null;
  readonly principal: bigint | null;
  readonly termMonths: number | null;
}

export const NO_TERMS: AccountTerms = {
  creditLimit: null,
  cutOffDay: null,
  paymentDay: null,
  monthlyRatePpm: null,
  annualRatePpm: null,
  termDays: null,
  maturityDate: null,
  principal: null,
  termMonths: null,
};

/** Undefined keeps a term, null clears it. */
export type TermsChange = { readonly [K in keyof AccountTerms]?: AccountTerms[K] };

const ALLOWED: Readonly<Partial<Record<AccountType, readonly (keyof AccountTerms)[]>>> = {
  CREDIT_CARD: ["creditLimit", "cutOffDay", "paymentDay", "monthlyRatePpm"],
  SAVINGS: ["annualRatePpm", "termDays", "maturityDate"],
  LOAN: ["principal", "annualRatePpm", "termMonths"],
};

const within = (value: number | null, min: number, max: number): boolean =>
  value === null || (Number.isInteger(value) && value >= min && value <= max);

/** HU-E2-06, rulings P52 and P54: the terms after `change`, checked for the account's type. */
export const revisedTerms = (
  type: AccountType,
  current: AccountTerms,
  change: TermsChange,
): Result<AccountTerms> => {
  const pick = <K extends keyof AccountTerms>(key: K): AccountTerms[K] =>
    change[key] === undefined ? current[key] : (change[key] as AccountTerms[K]);
  const next: AccountTerms = {
    creditLimit: pick("creditLimit"),
    cutOffDay: pick("cutOffDay"),
    paymentDay: pick("paymentDay"),
    monthlyRatePpm: pick("monthlyRatePpm"),
    annualRatePpm: pick("annualRatePpm"),
    termDays: pick("termDays"),
    maturityDate: pick("maturityDate"),
    principal: pick("principal"),
    termMonths: pick("termMonths"),
  };
  const allowed = ALLOWED[type] ?? [];
  const foreign = (Object.keys(next) as (keyof AccountTerms)[]).find(
    (k) => next[k] !== null && !allowed.includes(k),
  );
  if (foreign !== undefined) return err(domainError("AccountAttributeNotAllowed", { attribute: foreign }));
  if (next.creditLimit !== null && next.creditLimit <= 0n) return err(domainError("InvalidCreditLimit"));
  if (!within(next.cutOffDay, 1, 31) || !within(next.paymentDay, 1, 31)) {
    return err(domainError("InvalidBillingDay"));
  }
  if (!within(next.monthlyRatePpm, 0, MAX_RATE_PPM) || !within(next.annualRatePpm, 0, MAX_RATE_PPM)) {
    return err(domainError("InvalidRate"));
  }
  if ((next.termDays === null) !== (next.maturityDate === null) || !within(next.termDays, 1, 3_660)) {
    return err(domainError("InvalidTermDeposit"));
  }
  if (next.principal !== null && next.principal <= 0n) {
    return err(domainError("InvalidAmount", { amount: next.principal.toString() }));
  }
  if (!within(next.termMonths, 1, 480)) return err(domainError("InvalidTerm"));
  return ok(next);
};

/**
 * HU-E2-06, ruling P55: the next `day` of a month (clamped to its last day, like PeriodPolicy) on or after today.
 * Precondition: `day` is a whole number from 1 to 31 (what `revisedTerms` lets through); anything else is a
 * programming error and throws a RangeError.
 */
export const nextBillingDate = (day: number, today: LocalDate): LocalDate => {
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new RangeError(`A billing day runs from 1 to 31: ${day}`);
  }
  const { year, month } = partsOf(today);
  const inMonth = (y: number, m: number) => fromParts(y, m, Math.min(day, daysInMonth(y, m)));
  const thisMonth = inMonth(year, month);
  if (thisMonth >= today) return thisMonth;
  const next = addMonths(year, month, 1);
  return inMonth(next.year, next.month);
};

/** HU-E2-06: what the terms say on read, today being the requesting user's local date. */
export interface TermFigures {
  /** limit + balance; a card's balance is negative while money is owed. */
  readonly availableCredit: bigint | null;
  readonly nextCutOffDate: LocalDate | null;
  readonly nextPaymentDate: LocalDate | null;
  /** The card's monthly rate as % E.A. */
  readonly effectiveAnnualRatePpm: number | null;
  /** A savings account's or loan's annual rate as % M.V. */
  readonly equivalentMonthlyRatePpm: number | null;
  /** A term deposit's start: maturityDate − termDays. */
  readonly startDate: LocalDate | null;
}

export const termFigures = (terms: AccountTerms, balance: bigint, today: LocalDate): TermFigures => ({
  availableCredit: terms.creditLimit === null ? null : terms.creditLimit + balance,
  nextCutOffDate: terms.cutOffDay === null ? null : nextBillingDate(terms.cutOffDay, today),
  nextPaymentDate: terms.paymentDay === null ? null : nextBillingDate(terms.paymentDay, today),
  effectiveAnnualRatePpm: terms.monthlyRatePpm === null ? null : effectiveAnnualPpm(terms.monthlyRatePpm),
  equivalentMonthlyRatePpm: terms.annualRatePpm === null ? null : equivalentMonthlyPpm(terms.annualRatePpm),
  startDate:
    terms.maturityDate === null || terms.termDays === null
      ? null
      : addDays(terms.maturityDate, -terms.termDays),
});
