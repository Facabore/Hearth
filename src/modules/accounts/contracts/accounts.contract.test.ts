import { describe, expect, it } from "vitest";
import { domainError, err, localDate } from "@/shared/kernel";
import { unwrap } from "../../../../tests/support/fakes";
import { ACCOUNT_COLORS, ACCOUNT_ICONS, type AccountType, type TermsChange } from "../application";
import { toView } from "../application/account-view";
import { openAccount, type AccountId } from "../domain/account";
import { NO_TERMS } from "../domain/account-terms";
import {
  accountDto,
  attributesFromBody,
  CreateAccountBodySchema,
  TermsBodySchema,
  UpdateAccountBodySchema,
  withPublicField,
} from "./accounts.contract";

const base = { name: "Nequi", type: "WALLET", openingBalance: { amount: "0", currency: "COP" } };
const create = (attributes: Record<string, unknown>) =>
  CreateAccountBodySchema.safeParse({ ...base, ...attributes });
const update = (attributes: Record<string, unknown>) => UpdateAccountBodySchema.safeParse(attributes);

/** HU-E2-05, ruling P50: the contract is where these rules are enforced, so none may reach PostgreSQL. */
const refused: readonly [string, unknown][] = [
  ["institution", ""],
  ["institution", "   "],
  ["institution", "x".repeat(61)],
  ["institution", 42],
  ["lastFour", "123"],
  ["lastFour", "12345"],
  ["lastFour", "12a4"],
  ["lastFour", " 4821"],
  ["lastFour", "4821\n"],
  ["lastFour", "4111111111111111"],
  // Only ASCII digits: PostgreSQL checks `^[0-9]{4}$`, so a Unicode digit would answer 500 if it got through.
  ["lastFour", "٤٨٢١"], // Arabic-Indic
  ["lastFour", "４８２１"], // fullwidth
  ["lastFour", 4821],
  ["color", "purple"],
  ["color", "Pine"],
  ["color", "pine"],
  ["color", ""],
  ["icon", "rocket"],
  ["icon", "Wallet"],
  ["icon", "credit-card"],
  ["icon", ""],
];

describe("account attributes in the HTTP contract (HU-E2-05)", () => {
  it.each(refused)("refuses %s = %j when creating", (field, value) => {
    expect(create({ [field]: value }).success).toBe(false);
  });

  it.each(refused)("refuses %s = %j when updating", (field, value) => {
    expect(update({ [field]: value }).success).toBe(false);
  });

  it("accepts the edges of each rule", () => {
    const parsed = create({
      institution: "x".repeat(60),
      lastFour: "0000",
      color: "ROSE",
      icon: "phone",
    });
    expect(parsed.success).toBe(true);
    expect(create({ institution: "N" }).success).toBe(true);
  });

  it("accepts every palette key and every allow-listed icon", () => {
    for (const color of ACCOUNT_COLORS) expect(create({ color }).success).toBe(true);
    for (const icon of ACCOUNT_ICONS) expect(create({ icon }).success).toBe(true);
  });

  it("trims the institution before checking its length", () => {
    expect(create({ institution: "  Nequi  " }).data?.institution).toBe("Nequi");
    expect(create({ institution: `  ${"x".repeat(60)}  ` }).success).toBe(true);
  });

  it("clears an attribute with null only when updating", () => {
    const clear = { institution: null, lastFour: null, color: null, icon: null };
    expect(update(clear).data).toEqual(clear);
    for (const field of Object.keys(clear)) expect(create({ [field]: null }).success).toBe(false);
  });

  it("hands the four attributes to the use cases, keeping left out ones undefined and cleared ones null", () => {
    expect(
      attributesFromBody({ institution: "Nequi", lastFour: "4821", color: "PINE", icon: "wallet" }),
    ).toEqual({
      institution: "Nequi",
      lastFour: "4821",
      color: "PINE",
      icon: "wallet",
    });
    expect(attributesFromBody({})).toEqual({
      institution: undefined,
      lastFour: undefined,
      color: undefined,
      icon: undefined,
    });
    expect(attributesFromBody({ color: null, icon: null })).toMatchObject({ color: null, icon: null });
  });
});

/** HU-E2-06: every account answer carries the stored terms and what they derive, today being the requester's date. */
describe("account answers with terms and derived figures (HU-E2-06)", () => {
  const today = unwrap(localDate("2026-10-17"));
  const answer = (type: AccountType, terms: TermsChange, openingBalance = 0n) =>
    accountDto(
      toView(
        unwrap(
          openAccount({
            id: "acc-1" as AccountId,
            spaceId: "space-ana",
            spaceKind: "PERSONAL",
            ownerUserId: "u-ana",
            name: "Account",
            type,
            openingBalance,
            now: new Date("2026-10-12T12:00:00Z"),
            siblings: [],
            terms,
          }),
        ),
        "COP",
        today,
      ),
    );

  it("answers a credit card's limit and available credit as money, its rates as percents with four decimals", () => {
    const card = answer(
      "CREDIT_CARD",
      { creditLimit: 500_000_000n, cutOffDay: 20, paymentDay: 5, monthlyRatePpm: 20_000 },
      -35_000_000n,
    );

    expect(card.terms).toEqual({
      creditLimit: { amount: "500000000", currency: "COP" },
      cutOffDay: 20,
      paymentDay: 5,
      monthlyRate: "2.0000",
      annualRate: null,
      termDays: null,
      maturityDate: null,
      principal: null,
      termMonths: null,
    });
    expect(card.derived).toEqual({
      availableCredit: { amount: "465000000", currency: "COP" },
      nextCutOffDate: "2026-10-20",
      nextPaymentDate: "2026-11-05",
      effectiveAnnualRate: "26.8242",
      equivalentMonthlyRate: null,
      startDate: null,
    });
  });

  it("never caps a derived rate: a monthly rate of 100 % is 409,500 % a year", () => {
    const card = answer("CREDIT_CARD", { monthlyRatePpm: 1_000_000 });

    expect(card.terms.monthlyRate).toBe("100.0000");
    expect(card.derived.effectiveAnnualRate).toBe("409500.0000");
  });

  it("answers a term deposit's rate, term and dates, with the equivalent monthly rate and the start date", () => {
    const deposit = answer("SAVINGS", {
      annualRatePpm: 120_000,
      termDays: 90,
      maturityDate: unwrap(localDate("2026-12-31")),
    });

    expect(deposit.terms).toMatchObject({
      annualRate: "12.0000",
      termDays: 90,
      maturityDate: "2026-12-31",
      monthlyRate: null,
    });
    expect(deposit.derived).toMatchObject({
      equivalentMonthlyRate: "0.9489",
      startDate: "2026-10-02",
      availableCredit: null,
      effectiveAnnualRate: null,
    });
  });

  it("answers a loan's principal as money, in the account's currency", () => {
    const loan = answer("LOAN", { principal: 1_200_000_000n, annualRatePpm: 120_000, termMonths: 36 });

    expect(loan.terms).toMatchObject({
      principal: { amount: "1200000000", currency: "COP" },
      annualRate: "12.0000",
      termMonths: 36,
    });
    expect(loan.derived.equivalentMonthlyRate).toBe("0.9489");
  });

  it("answers null for every term and derived figure of an account without terms", () => {
    const wallet = answer("WALLET", {});

    expect(wallet.terms).toEqual({
      creditLimit: null,
      cutOffDay: null,
      paymentDay: null,
      monthlyRate: null,
      annualRate: null,
      termDays: null,
      maturityDate: null,
      principal: null,
      termMonths: null,
    });
    expect(wallet.derived).toEqual({
      availableCredit: null,
      nextCutOffDate: null,
      nextPaymentDate: null,
      effectiveAnnualRate: null,
      equivalentMonthlyRate: null,
      startDate: null,
    });
  });
});

/** HU-E2-06: a refused term is named as the key inside the body's `terms`, so a form can highlight the field. */
describe("the field an account type refuses (HU-E2-06)", () => {
  const refusal = (attribute: unknown) => err(domainError("AccountAttributeNotAllowed", { attribute }));

  it("names a rate without its stored unit: monthlyRatePpm is monthlyRate, annualRatePpm is annualRate", () => {
    expect(withPublicField(refusal("monthlyRatePpm"))).toEqual(
      err(domainError("AccountAttributeNotAllowed", { attribute: "monthlyRatePpm", field: "monthlyRate" })),
    );
    expect(withPublicField(refusal("annualRatePpm"))).toMatchObject({
      error: { details: { field: "annualRate" } },
    });
  });

  it("names every stored term as a property of the body's terms", () => {
    const fields = Object.keys(NO_TERMS).map(
      (attribute) => withPublicField(refusal(attribute)).error.details?.field,
    );
    expect([...fields].sort()).toEqual(Object.keys(TermsBodySchema.shape).sort());
  });

  it("leaves every other failure, and one without a named attribute, as it is", () => {
    const other = err(domainError("InvalidRate", { attribute: "monthlyRatePpm" }));
    expect(withPublicField(other)).toBe(other);
    const bare = err(domainError("AccountAttributeNotAllowed"));
    expect(withPublicField(bare)).toBe(bare);
    const odd = refusal(7);
    expect(withPublicField(odd)).toBe(odd);
  });
});

/** Issue 120 (P253): an answer carries the effective icon and switches, what is stored (null: the default) and the defaults. */
describe("account answers with stored, effective and default style (issue 120)", () => {
  const today = unwrap(localDate("2026-10-17"));
  const answer = (attributes: Parameters<typeof openAccount>[0]["attributes"]) =>
    accountDto(
      toView(
        unwrap(
          openAccount({
            id: "acc-1" as AccountId,
            spaceId: "space-ana",
            spaceKind: "PERSONAL",
            ownerUserId: "u-ana",
            name: "Visa",
            type: "CREDIT_CARD",
            openingBalance: 0n,
            now: new Date("2026-10-12T12:00:00Z"),
            siblings: [],
            attributes,
          }),
        ),
        "COP",
        today,
      ),
    );
  const defaults = { icon: "card", includeInAvailable: false, includeInNetWorth: true };

  it("answers null as stored, and the type's defaults as effective, for an account that set nothing", () => {
    const card = answer(undefined);

    expect(card).toMatchObject({ icon: "card", includeInAvailable: false, includeInNetWorth: true });
    expect(card.stored).toEqual({ icon: null, includeInAvailable: null, includeInNetWorth: null });
    expect(card.defaults).toEqual(defaults);
  });

  it("answers what was chosen as stored and effective, and the type's defaults beside them", () => {
    const card = answer({ icon: "star", includeInAvailable: true, includeInNetWorth: true });

    expect(card).toMatchObject({ icon: "star", includeInAvailable: true, includeInNetWorth: true });
    expect(card.stored).toEqual({ icon: "star", includeInAvailable: true, includeInNetWorth: true });
    expect(card.defaults).toEqual(defaults);
  });
});
