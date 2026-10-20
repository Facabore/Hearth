import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { LocalDate } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { personalSpaceFixture, type SpaceFixture } from "../../../../tests/support/fixtures";
import { NO_ATTRIBUTES, type Account, type AccountId } from "../domain/account";
import { NO_TERMS, revisedTerms, type TermsChange } from "../domain/account-terms";
import { MAX_RATE_PPM } from "../domain/rate";
import { DrizzleAccountRepository } from "./drizzle-account-repository";

const { db, pool } = testDatabase();
const repo = new DrizzleAccountRepository(new DrizzleTransactionManager(db));
const account = (space: SpaceFixture, overrides: Partial<Account> = {}): Account => ({
  id: randomUUID() as AccountId,
  spaceId: space.spaceId,
  name: "Bancolombia",
  type: "BANK",
  ownerUserId: space.userId,
  openingBalance: 200_000_000n,
  archivedAt: null,
  createdAt: new Date("2026-10-12T12:00:00Z"),
  ...NO_ATTRIBUTES,
  ...overrides,
});

afterAll(() => pool.end());

describe("DrizzleAccountRepository", () => {
  it("stores, finds and lists accounts with exact bigint opening balances", async () => {
    const space = await personalSpaceFixture(db, pool);
    const bank = account(space);
    const card = account(space, { name: "Visa", type: "CREDIT_CARD", openingBalance: -35_000_000n });
    const huge = account(space, {
      name: "Huge",
      type: "SAVINGS",
      openingBalance: 9_223_372_036_854_775_807n,
    });
    for (const a of [bank, card, huge]) await repo.add(a);
    expect(await repo.findById(bank.id)).toEqual(bank);
    expect(await repo.findById(huge.id)).toEqual(huge);
    expect(await repo.listBySpace(space.spaceId)).toEqual(expect.arrayContaining([bank, card, huge]));
  });

  it("returns null for unknown and malformed ids", async () => {
    expect(await repo.findById(randomUUID())).toBeNull();
    expect(await repo.findById("not-a-uuid")).toBeNull();
  });

  it("saves name, opening balance and archive state", async () => {
    const space = await personalSpaceFixture(db, pool);
    const bank = account(space);
    await repo.add(bank);
    const archivedAt = new Date("2026-10-20T00:00:00Z");
    await repo.save({ ...bank, name: "Bancolombia Ahorros", openingBalance: 210_000_000n, archivedAt });
    expect(await repo.findById(bank.id)).toEqual({
      ...bank,
      name: "Bancolombia Ahorros",
      openingBalance: 210_000_000n,
      archivedAt,
    });
  });

  it("enforces unique names per space ignoring case, but not across spaces", async () => {
    const ana = await personalSpaceFixture(db, pool);
    const juan = await personalSpaceFixture(db, pool, "Juan");
    await repo.add(account(ana));
    await expect(repo.add(account(ana, { name: "BANCOLOMBIA" }))).rejects.toThrow();
    await expect(repo.add(account(juan))).resolves.toBeUndefined();
  });

  it("requires an owner for every account type except SHARED_FUND", async () => {
    const space = await personalSpaceFixture(db, pool);
    await expect(repo.add(account(space, { ownerUserId: null }))).rejects.toThrow();
  });
});

describe("account attributes (HU-E2-05)", () => {
  it("round-trips the new types and the common attributes, and refuses a full card number", async () => {
    const space = await personalSpaceFixture(db, pool);
    const wallet = account(space, {
      name: "Nequi",
      type: "WALLET",
      institution: "Nequi",
      lastFour: "4821",
      color: "PINE",
      icon: "wallet",
      includeInAvailable: false,
      includeInNetWorth: true,
    });
    await repo.add(wallet);
    expect(await repo.findById(wallet.id)).toEqual(wallet);
    await repo.save({
      ...wallet,
      institution: null,
      lastFour: "1234",
      color: "EMBER",
      icon: null,
      includeInAvailable: null,
      includeInNetWorth: false,
    });
    expect(await repo.findById(wallet.id)).toMatchObject({
      institution: null,
      lastFour: "1234",
      color: "EMBER",
      icon: null,
      includeInAvailable: null,
      includeInNetWorth: false,
    });
    await expect(
      pool.query(`UPDATE accounts SET last_four = '4111111111111111' WHERE id = $1`, [wallet.id]),
    ).rejects.toMatchObject({ constraint: "accounts_last_four" });
  });
});

describe("account terms (HU-E2-06)", () => {
  it("round-trips every term exactly and pins which type holds which", async () => {
    const space = await personalSpaceFixture(db, pool);
    const card = account(space, {
      name: "Visa",
      type: "CREDIT_CARD",
      terms: {
        ...NO_TERMS,
        creditLimit: 9_223_372_036_854_775_807n,
        cutOffDay: 31,
        paymentDay: 15,
        monthlyRatePpm: 20_000,
      },
    });
    const cdt = account(space, {
      name: "CDT",
      type: "SAVINGS",
      terms: { ...NO_TERMS, annualRatePpm: 95_000, termDays: 180, maturityDate: "2027-04-14" as LocalDate },
    });
    await repo.add(card);
    await repo.add(cdt);
    expect(await repo.findById(card.id)).toEqual(card);
    expect(await repo.findById(cdt.id)).toEqual(cdt);
    await expect(
      pool.query(`UPDATE accounts SET credit_limit = 1 WHERE id = $1`, [cdt.id]),
    ).rejects.toMatchObject({
      constraint: "accounts_card_terms",
    });
    await expect(
      pool.query(`UPDATE accounts SET maturity_date = NULL WHERE id = $1`, [cdt.id]),
    ).rejects.toMatchObject({
      constraint: "accounts_term_deposit",
    });
  });

  it("saves revised and cleared terms, and keeps loan terms on loans and annual rates on savings and loans", async () => {
    const space = await personalSpaceFixture(db, pool);
    const card = account(space, {
      name: "Visa",
      type: "CREDIT_CARD",
      terms: { ...NO_TERMS, creditLimit: 500_000_000n, cutOffDay: 20, paymentDay: 5, monthlyRatePpm: 20_000 },
    });
    const loan = account(space, {
      name: "Crédito libre inversión",
      type: "LOAN",
      terms: { ...NO_TERMS, principal: 2_000_000_000n, annualRatePpm: 180_000, termMonths: 36 },
    });
    await repo.add(card);
    await repo.add(loan);
    const revised = { ...card, terms: { ...card.terms, creditLimit: 600_000_000n, paymentDay: null } };
    await repo.save(revised);
    expect(await repo.findById(card.id)).toEqual(revised);
    await expect(
      pool.query(`UPDATE accounts SET principal = 1 WHERE id = $1`, [card.id]),
    ).rejects.toMatchObject({
      constraint: "accounts_loan_terms",
    });
    await expect(
      pool.query(`UPDATE accounts SET annual_rate_ppm = 1 WHERE id = $1`, [card.id]),
    ).rejects.toMatchObject({
      constraint: "accounts_annual_rate",
    });
    await expect(
      pool.query(`UPDATE accounts SET term_months = 12 WHERE id = $1`, [card.id]),
    ).rejects.toMatchObject({
      constraint: "accounts_loan_terms",
    });
  });

  // termFigures dates the next billing day on every read: a stored day outside 1-31 would make that read throw.
  it.each([
    ["cut_off_day", "accounts_cut_off_day"],
    ["payment_day", "accounts_payment_day"],
  ])("refuses a %s outside 1 to 31 and keeps the first and last day", async (column, constraint) => {
    const space = await personalSpaceFixture(db, pool);
    const card = account(space, {
      name: "Visa",
      type: "CREDIT_CARD",
      terms: { ...NO_TERMS, creditLimit: 500_000_000n, cutOffDay: 20, paymentDay: 5 },
    });
    await repo.add(card);
    for (const day of [0, 32]) {
      await expect(
        pool.query(`UPDATE accounts SET ${column} = $1 WHERE id = $2`, [day, card.id]),
      ).rejects.toMatchObject({ constraint });
    }
    for (const day of [1, 31]) {
      await expect(
        pool.query(`UPDATE accounts SET ${column} = $1 WHERE id = $2`, [day, card.id]),
      ).resolves.toBeDefined();
    }
  });

  // equivalentMonthlyPpm and percentText throw on a negative rate: a stored rate outside 0 to 100 % is refused too.
  it.each([
    ["monthly_rate_ppm", "accounts_monthly_rate_range", "CREDIT_CARD"],
    ["annual_rate_ppm", "accounts_annual_rate_range", "SAVINGS"],
  ] as const)("refuses a %s below 0 or above the domain's maximum", async (column, constraint, type) => {
    const space = await personalSpaceFixture(db, pool);
    const holder = account(space, { name: "Holder", type });
    await repo.add(holder);
    for (const ppm of [-1, MAX_RATE_PPM + 1]) {
      await expect(
        pool.query(`UPDATE accounts SET ${column} = $1 WHERE id = $2`, [ppm, holder.id]),
      ).rejects.toMatchObject({ constraint });
    }
    for (const ppm of [0, MAX_RATE_PPM]) {
      await expect(
        pool.query(`UPDATE accounts SET ${column} = $1 WHERE id = $2`, [ppm, holder.id]),
      ).resolves.toBeDefined();
    }
  });

  it("refuses a term deposit's terms on any other type", async () => {
    const space = await personalSpaceFixture(db, pool);
    const card = account(space, { name: "Visa", type: "CREDIT_CARD" });
    await repo.add(card);
    await expect(
      pool.query(`UPDATE accounts SET term_days = 180, maturity_date = '2027-04-14' WHERE id = $1`, [
        card.id,
      ]),
    ).rejects.toMatchObject({ constraint: "accounts_term_deposit" });
  });

  // reviseAccount re-validates the stored terms on every update, even a rename: a stored term outside the domain's
  // range would answer InvalidTermDeposit, InvalidTerm, InvalidCreditLimit or InvalidAmount from then on.
  it.each([
    {
      column: "term_days",
      constraint: "accounts_term_days_range",
      type: "SAVINGS" as const,
      assignment: "term_days = $1, maturity_date = '2027-04-14'",
      change: (v: number): TermsChange => ({ termDays: v, maturityDate: "2027-04-14" as LocalDate }),
      refused: [0, 3661],
      accepted: [1, 3660],
    },
    {
      column: "term_months",
      constraint: "accounts_term_months_range",
      type: "LOAN" as const,
      assignment: "term_months = $1",
      change: (v: number): TermsChange => ({ termMonths: v }),
      refused: [0, 481],
      accepted: [1, 480],
    },
    {
      column: "credit_limit",
      constraint: "accounts_credit_limit_positive",
      type: "CREDIT_CARD" as const,
      assignment: "credit_limit = $1",
      change: (v: number): TermsChange => ({ creditLimit: BigInt(v) }),
      refused: [0, -1],
      accepted: [1],
    },
    {
      column: "principal",
      constraint: "accounts_principal_positive",
      type: "LOAN" as const,
      assignment: "principal = $1",
      change: (v: number): TermsChange => ({ principal: BigInt(v) }),
      refused: [0, -1],
      accepted: [1],
    },
  ])(
    "holds $column to the domain's range: refuses $refused, keeps $accepted",
    async ({ constraint, type, assignment, change, refused, accepted }) => {
      const space = await personalSpaceFixture(db, pool);
      const holder = account(space, { name: "Holder", type });
      await repo.add(holder);
      for (const value of refused) {
        expect(revisedTerms(type, NO_TERMS, change(value)).ok).toBe(false);
        await expect(
          pool.query(`UPDATE accounts SET ${assignment} WHERE id = $2`, [value, holder.id]),
        ).rejects.toMatchObject({ constraint });
      }
      for (const value of accepted) {
        expect(revisedTerms(type, NO_TERMS, change(value)).ok).toBe(true);
        await expect(
          pool.query(`UPDATE accounts SET ${assignment} WHERE id = $2`, [value, holder.id]),
        ).resolves.toBeDefined();
      }
    },
  );
});
