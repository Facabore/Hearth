import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { nextBillingDate, NO_TERMS, revisedTerms, termFigures } from "./account-terms";

const day = (iso: string) => iso as LocalDate;
const visa = { creditLimit: 500_000_000n, cutOffDay: 20, paymentDay: 5, monthlyRatePpm: 20_000 };
const cdt = { annualRatePpm: 95_000, termDays: 180, maturityDate: day("2027-04-14") };

describe("type-specific terms (HU-E2-06)", () => {
  it("keeps a card's, a CDT's and a loan's terms", () => {
    expect(unwrap(revisedTerms("CREDIT_CARD", NO_TERMS, visa))).toEqual({ ...NO_TERMS, ...visa });
    expect(unwrap(revisedTerms("SAVINGS", NO_TERMS, cdt))).toEqual({ ...NO_TERMS, ...cdt });
    const loan = { principal: 2_000_000_000n, annualRatePpm: 180_000, termMonths: 36 };
    expect(unwrap(revisedTerms("LOAN", NO_TERMS, loan))).toEqual({ ...NO_TERMS, ...loan });
    expect(unwrap(revisedTerms("SAVINGS", NO_TERMS, { annualRatePpm: 40_000 })).termDays).toBeNull();
  });

  it("refuses terms of another type, naming the attribute", () => {
    expect(revisedTerms("BANK", NO_TERMS, { creditLimit: 100_000_000n })).toEqual({
      ok: false,
      error: { code: "AccountAttributeNotAllowed", details: { attribute: "creditLimit" } },
    });
    expect(codeOf(revisedTerms("SHARED_FUND", NO_TERMS, { annualRatePpm: 1 }))).toBe(
      "AccountAttributeNotAllowed",
    );
    expect(codeOf(revisedTerms("CREDIT_CARD", NO_TERMS, { termMonths: 12 }))).toBe(
      "AccountAttributeNotAllowed",
    );
  });

  it.each([
    ["CREDIT_CARD", { cutOffDay: 32 }, "InvalidBillingDay"],
    ["CREDIT_CARD", { paymentDay: 0 }, "InvalidBillingDay"],
    ["CREDIT_CARD", { creditLimit: 0n }, "InvalidCreditLimit"],
    ["CREDIT_CARD", { monthlyRatePpm: 1_000_001 }, "InvalidRate"],
    ["SAVINGS", { termDays: 180 }, "InvalidTermDeposit"],
    ["SAVINGS", { termDays: 3_661, maturityDate: day("2036-10-16") }, "InvalidTermDeposit"],
    ["LOAN", { termMonths: 0 }, "InvalidTerm"],
    ["LOAN", { principal: 0n }, "InvalidAmount"],
  ] as const)("refuses %s %o with %s", (type, change, code) => {
    expect(codeOf(revisedTerms(type, NO_TERMS, change))).toBe(code);
  });

  it("clears a term with null and keeps what the change leaves out", () => {
    const card = unwrap(revisedTerms("CREDIT_CARD", NO_TERMS, visa));
    expect(unwrap(revisedTerms("CREDIT_CARD", card, { monthlyRatePpm: null }))).toEqual({
      ...card,
      monthlyRatePpm: null,
    });
    const deposit = unwrap(revisedTerms("SAVINGS", NO_TERMS, cdt));
    expect(codeOf(revisedTerms("SAVINGS", deposit, { maturityDate: null }))).toBe("InvalidTermDeposit");
  });

  it("keeps a term the change names as undefined, as it keeps one it leaves out", () => {
    const card = unwrap(revisedTerms("CREDIT_CARD", NO_TERMS, visa));
    expect(unwrap(revisedTerms("CREDIT_CARD", card, { cutOffDay: undefined, paymentDay: 7 }))).toEqual({
      ...card,
      paymentDay: 7,
    });
  });

  it("checks the terms the account already carries as well as the ones the change brings", () => {
    const stored = { ...NO_TERMS, creditLimit: 100_000_000n };
    expect(codeOf(revisedTerms("BANK", stored, { cutOffDay: null }))).toBe("AccountAttributeNotAllowed");
    expect(unwrap(revisedTerms("BANK", stored, { creditLimit: null }))).toEqual(NO_TERMS);
  });

  it("lets any type clear a term it cannot carry, which changes nothing", () => {
    for (const type of ["CASH", "BANK", "WALLET", "INVESTMENT", "OTHER", "SHARED_FUND"] as const) {
      expect(
        unwrap(revisedTerms(type, NO_TERMS, { creditLimit: null, annualRatePpm: null, termMonths: null })),
      ).toEqual(NO_TERMS);
    }
  });

  it("names the first foreign attribute in a fixed order, whatever order the change lists them", () => {
    const error = revisedTerms("BANK", NO_TERMS, { termMonths: 12, creditLimit: 1n });
    expect(error).toEqual({
      ok: false,
      error: { code: "AccountAttributeNotAllowed", details: { attribute: "creditLimit" } },
    });
  });

  it("names the attribute each type may not carry (ruling P54)", () => {
    const foreign: ReadonlyArray<
      readonly [Parameters<typeof revisedTerms>[0], Parameters<typeof revisedTerms>[2], string]
    > = [
      ["CASH", { monthlyRatePpm: 1 }, "monthlyRatePpm"],
      ["WALLET", { cutOffDay: 1 }, "cutOffDay"],
      ["INVESTMENT", { principal: 1n }, "principal"],
      ["OTHER", { paymentDay: 1 }, "paymentDay"],
      ["SHARED_FUND", { termDays: 30 }, "termDays"],
      ["CREDIT_CARD", { annualRatePpm: 1 }, "annualRatePpm"],
      ["CREDIT_CARD", { principal: 1n }, "principal"],
      ["SAVINGS", { creditLimit: 1n }, "creditLimit"],
      ["SAVINGS", { monthlyRatePpm: 1 }, "monthlyRatePpm"],
      ["LOAN", { creditLimit: 1n }, "creditLimit"],
      ["LOAN", { termDays: 30 }, "termDays"],
      ["LOAN", { maturityDate: day("2027-04-14") }, "maturityDate"],
    ];
    for (const [type, change, attribute] of foreign) {
      expect(revisedTerms(type, NO_TERMS, change)).toEqual({
        ok: false,
        error: { code: "AccountAttributeNotAllowed", details: { attribute } },
      });
    }
  });

  it("refuses a loan's principal that is not positive, naming it", () => {
    expect(revisedTerms("LOAN", NO_TERMS, { principal: 0n })).toEqual({
      ok: false,
      error: { code: "InvalidAmount", details: { amount: "0" } },
    });
    expect(revisedTerms("LOAN", NO_TERMS, { principal: -5n })).toEqual({
      ok: false,
      error: { code: "InvalidAmount", details: { amount: "-5" } },
    });
  });

  // The brief's table above refuses cutOffDay 32, paymentDay 0, a rate of 1,000,001, termDays 180 alone and 3,661,
  // termMonths 0 and a principal of 0; these pin the inside edge of each range and the refusals it leaves out.
  it.each([
    ["CREDIT_CARD", { creditLimit: 1n }],
    ["CREDIT_CARD", { cutOffDay: 1 }],
    ["CREDIT_CARD", { cutOffDay: 31 }],
    ["CREDIT_CARD", { paymentDay: 1 }],
    ["CREDIT_CARD", { paymentDay: 31 }],
    ["CREDIT_CARD", { monthlyRatePpm: 0 }],
    ["CREDIT_CARD", { monthlyRatePpm: 1_000_000 }],
    ["SAVINGS", { annualRatePpm: 0 }],
    ["SAVINGS", { annualRatePpm: 1_000_000 }],
    ["LOAN", { annualRatePpm: 1_000_000 }],
    ["LOAN", { principal: 1n }],
    ["LOAN", { termMonths: 1 }],
    ["LOAN", { termMonths: 480 }],
  ] as const)("%s takes %o, at the edge of its range", (type, change) => {
    expect(codeOf(revisedTerms(type, NO_TERMS, change))).toBe("ok");
  });

  it.each([
    ["CREDIT_CARD", { creditLimit: -1n }, "InvalidCreditLimit"],
    ["CREDIT_CARD", { cutOffDay: 0 }, "InvalidBillingDay"],
    ["CREDIT_CARD", { paymentDay: 32 }, "InvalidBillingDay"],
    ["CREDIT_CARD", { cutOffDay: 15.5 }, "InvalidBillingDay"],
    ["CREDIT_CARD", { monthlyRatePpm: -1 }, "InvalidRate"],
    ["CREDIT_CARD", { monthlyRatePpm: 20_000.5 }, "InvalidRate"],
    ["SAVINGS", { annualRatePpm: -1 }, "InvalidRate"],
    ["SAVINGS", { annualRatePpm: 1_000_001 }, "InvalidRate"],
    ["LOAN", { annualRatePpm: 1_000_001 }, "InvalidRate"],
    ["LOAN", { termMonths: 481 }, "InvalidTerm"],
    ["LOAN", { termMonths: 12.5 }, "InvalidTerm"],
  ] as const)("refuses %s %o with %s", (type, change, code) => {
    expect(codeOf(revisedTerms(type, NO_TERMS, change))).toBe(code);
  });

  it("holds a term deposit's days between 1 and 3,660 and takes its two terms together or not at all", () => {
    const maturity = day("2027-04-14");
    expect(codeOf(revisedTerms("SAVINGS", NO_TERMS, { termDays: 1, maturityDate: maturity }))).toBe("ok");
    expect(codeOf(revisedTerms("SAVINGS", NO_TERMS, { termDays: 3_660, maturityDate: maturity }))).toBe("ok");
    expect(codeOf(revisedTerms("SAVINGS", NO_TERMS, { termDays: 0, maturityDate: maturity }))).toBe(
      "InvalidTermDeposit",
    );
    expect(codeOf(revisedTerms("SAVINGS", NO_TERMS, { termDays: 30.5, maturityDate: maturity }))).toBe(
      "InvalidTermDeposit",
    );
    expect(codeOf(revisedTerms("SAVINGS", NO_TERMS, { maturityDate: maturity }))).toBe("InvalidTermDeposit");
    const deposit = unwrap(revisedTerms("SAVINGS", NO_TERMS, cdt));
    expect(unwrap(revisedTerms("SAVINGS", deposit, { termDays: null, maturityDate: null }))).toEqual({
      ...NO_TERMS,
      annualRatePpm: 95_000,
    });
  });
});

describe("billing dates and figures (HU-E2-06)", () => {
  it("clamps billing days to short months and finds the next one on or after today (Review Focus 4)", () => {
    expect(nextBillingDate(31, day("2026-11-16"))).toBe("2026-11-30");
    expect(nextBillingDate(15, day("2026-11-16"))).toBe("2026-12-15");
    expect(nextBillingDate(16, day("2026-11-16"))).toBe("2026-11-16");
    expect(nextBillingDate(31, day("2027-02-01"))).toBe("2027-02-28");
    expect(nextBillingDate(30, day("2028-02-29"))).toBe("2028-02-29");
    expect(nextBillingDate(5, day("2026-12-20"))).toBe("2027-01-05");
  });

  it("clamps the day of the following month too, and keeps today when the day is today", () => {
    expect(nextBillingDate(30, day("2027-01-31"))).toBe("2027-02-28");
    expect(nextBillingDate(31, day("2028-01-31"))).toBe("2028-01-31");
    expect(nextBillingDate(31, day("2028-02-01"))).toBe("2028-02-29");
    expect(nextBillingDate(29, day("2027-02-28"))).toBe("2027-02-28");
    expect(nextBillingDate(29, day("2027-03-01"))).toBe("2027-03-29");
    expect(nextBillingDate(1, day("2026-11-30"))).toBe("2026-12-01");
    expect(nextBillingDate(1, day("2026-11-01"))).toBe("2026-11-01");
  });

  it("refuses a billing day that is not a whole number from 1 to 31, and still takes both ends", () => {
    for (const outside of [0, -1, 32, 15.5, Number.NaN]) {
      expect(() => nextBillingDate(outside, day("2026-11-16"))).toThrow(RangeError);
    }
    expect(nextBillingDate(1, day("2026-11-16"))).toBe("2026-12-01");
    expect(nextBillingDate(31, day("2026-12-16"))).toBe("2026-12-31");
  });

  it("derives available credit, next dates, equivalent rates and a CDT's start date", () => {
    const card = unwrap(revisedTerms("CREDIT_CARD", NO_TERMS, visa));
    expect(termFigures(card, -35_000_000n, day("2026-10-16"))).toEqual({
      availableCredit: 465_000_000n,
      nextCutOffDate: "2026-10-20",
      nextPaymentDate: "2026-11-05",
      effectiveAnnualRatePpm: 268_242,
      equivalentMonthlyRatePpm: null,
      startDate: null,
    });
    const deposit = unwrap(revisedTerms("SAVINGS", NO_TERMS, cdt));
    expect(termFigures(deposit, 1_000_000_000n, day("2026-10-16"))).toMatchObject({
      startDate: "2026-10-16",
    });
    expect(termFigures(NO_TERMS, 0n, day("2026-10-16"))).toEqual({
      availableCredit: null,
      nextCutOffDate: null,
      nextPaymentDate: null,
      effectiveAnnualRatePpm: null,
      equivalentMonthlyRatePpm: null,
      startDate: null,
    });
  });

  it("derives a savings account's and a loan's monthly equivalent, and nothing else from a rate alone", () => {
    const today = day("2026-10-16");
    const deposit = unwrap(revisedTerms("SAVINGS", NO_TERMS, cdt));
    expect(termFigures(deposit, 1_000_000_000n, today)).toEqual({
      availableCredit: null,
      nextCutOffDate: null,
      nextPaymentDate: null,
      effectiveAnnualRatePpm: null,
      equivalentMonthlyRatePpm: 7_592,
      startDate: "2026-10-16",
    });
    const loan = unwrap(
      revisedTerms("LOAN", NO_TERMS, { principal: 2_000_000_000n, annualRatePpm: 180_000 }),
    );
    expect(termFigures(loan, -2_000_000_000n, today)).toEqual({
      availableCredit: null,
      nextCutOffDate: null,
      nextPaymentDate: null,
      effectiveAnnualRatePpm: null,
      equivalentMonthlyRatePpm: 13_888,
      startDate: null,
    });
  });

  it("adds the balance to the limit, so money paid in raises the credit available", () => {
    const card = unwrap(revisedTerms("CREDIT_CARD", NO_TERMS, { creditLimit: 500_000_000n }));
    expect(termFigures(card, 12_000_000n, day("2026-10-16")).availableCredit).toBe(512_000_000n);
    expect(termFigures(card, 0n, day("2026-10-16")).availableCredit).toBe(500_000_000n);
  });

  it("derives each billing date and the rate figures on their own", () => {
    const today = day("2026-10-16");
    const cutOffOnly = unwrap(revisedTerms("CREDIT_CARD", NO_TERMS, { cutOffDay: 31 }));
    expect(termFigures(cutOffOnly, 0n, today)).toMatchObject({
      nextCutOffDate: "2026-10-31",
      nextPaymentDate: null,
      effectiveAnnualRatePpm: null,
    });
    const paymentOnly = unwrap(revisedTerms("CREDIT_CARD", NO_TERMS, { paymentDay: 10 }));
    expect(termFigures(paymentOnly, 0n, today)).toMatchObject({
      nextCutOffDate: null,
      nextPaymentDate: "2026-11-10",
    });
    const interestFree = unwrap(revisedTerms("CREDIT_CARD", NO_TERMS, { monthlyRatePpm: 0 }));
    expect(termFigures(interestFree, 0n, today).effectiveAnnualRatePpm).toBe(0);
  });

  it("starts a term deposit its days before it matures, across a year and a leap day", () => {
    const today = day("2026-10-16");
    const start = (termDays: number, maturityDate: LocalDate) =>
      termFigures(unwrap(revisedTerms("SAVINGS", NO_TERMS, { termDays, maturityDate })), 0n, today).startDate;
    expect(start(365, day("2027-04-14"))).toBe("2026-04-14");
    expect(start(1, day("2027-03-01"))).toBe("2027-02-28");
    expect(start(366, day("2028-03-01"))).toBe("2027-03-01");
  });
});
