import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listAccounts, POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import { PATCH as updateAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { cop, inSpace } from "../support/ledger";
import { actingIn, newSharedSpace } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

export interface AccountDto {
  id: string;
  name: string;
  type: string;
  balance: { amount: string; currency: string };
  institution: string | null;
  lastFour: string | null;
  color: string | null;
  icon: string;
  [field: string]: unknown;
}
const create = (user: TestUser, body: Record<string, unknown>) =>
  call(createAccount, "POST", inSpace(user, "accounts"), { user, params: { spaceId: user.spaceId }, body });
const created = async (user: TestUser, body: Record<string, unknown>): Promise<AccountDto> => {
  const response = await create(user, body);
  if (response.status !== 201) throw new Error(`account failed with status ${response.status}`);
  return (await response.json()) as AccountDto;
};
const patch = (user: TestUser, id: string, body: unknown) =>
  call(updateAccount, "PATCH", inSpace(user, `accounts/${id}`), {
    user,
    params: { spaceId: user.spaceId, accountId: id },
    body,
  });
const listOf = async (user: TestUser) =>
  (
    (await (
      await call(listAccounts, "GET", inSpace(user, "accounts"), { user, params: { spaceId: user.spaceId } })
    ).json()) as {
      items: AccountDto[];
    }
  ).items;

describe("account types and common attributes (HU-E2-05)", () => {
  it("creates a wallet with its common attributes", async () => {
    const ana = await registerUser("Ana");
    const nequi = await created(ana, {
      name: "Nequi",
      type: "WALLET",
      openingBalance: cop(300_000),
      institution: "Nequi",
      lastFour: "4821",
      color: "PINE",
      icon: "wallet",
    });
    expect(nequi).toMatchObject({
      type: "WALLET",
      institution: "Nequi",
      lastFour: "4821",
      color: "PINE",
      icon: "wallet",
    });
    expect((await listOf(ana)).map((a) => a.id)).toEqual([nequi.id]);
  });

  it("gives attributes left out the type defaults", async () => {
    const ana = await registerUser("Ana");
    const cash = await created(ana, { name: "Efectivo", type: "CASH", openingBalance: cop(0) });
    expect([cash.icon, cash.institution, cash.lastFour, cash.color]).toEqual(["cash", null, null, null]);
  });

  it.each(["WALLET", "INVESTMENT", "LOAN", "OTHER"])(
    "keeps %s accounts out of shared spaces",
    async (type) => {
      const ana = await registerUser("Ana");
      const household = actingIn(ana, await newSharedSpace(ana));
      expect(await problemOf(await create(household, { name: "X", type, openingBalance: cop(0) }))).toEqual([
        409,
        "PersonalAccountRequiresPersonalSpace",
      ]);
    },
  );

  it("accepts only the last four digits of a card", async () => {
    const ana = await registerUser("Ana");
    const visa = await created(ana, { name: "Visa", type: "CREDIT_CARD", openingBalance: cop(-350_000) });
    expect(await problemOf(await patch(ana, visa.id, { lastFour: "4111111111111111" }))).toEqual([
      422,
      "ValidationFailed",
    ]);
    expect((await listOf(ana))[0]?.lastFour).toBeNull();
  });

  it.each(["4111111111111111", "123", "12a4"])(
    "refuses the last four digits %s when creating, answering 422 and storing nothing",
    async (lastFour) => {
      const ana = await registerUser("Ana");
      const response = await create(ana, {
        name: "Visa",
        type: "CREDIT_CARD",
        openingBalance: cop(0),
        lastFour,
      });
      expect(await problemOf(response)).toEqual([422, "ValidationFailed"]);
      expect(await listOf(ana)).toEqual([]);
    },
  );

  it("changes and clears common attributes, never the type", async () => {
    const ana = await registerUser("Ana");
    const nequi = await created(ana, {
      name: "Nequi",
      type: "WALLET",
      openingBalance: cop(0),
      color: "PINE",
      icon: "star",
    });
    expect(await (await patch(ana, nequi.id, { color: "EMBER", icon: null })).json()).toMatchObject({
      color: "EMBER",
      icon: "wallet",
    });
    expect(await problemOf(await patch(ana, nequi.id, { type: "BANK" }))).toEqual([
      409,
      "AccountTypeImmutable",
    ]);
    expect(await problemOf(await patch(ana, nequi.id, { color: "purple" }))).toEqual([
      422,
      "ValidationFailed",
    ]);
  });

  it("keeps the attributes a PATCH leaves out and clears the ones it sets to null", async () => {
    const ana = await registerUser("Ana");
    const visa = await created(ana, {
      name: "Visa",
      type: "CREDIT_CARD",
      openingBalance: cop(-350_000),
      institution: "Bancolombia",
      lastFour: "4821",
      color: "SKY",
      icon: "star",
    });
    const set = { institution: "Bancolombia", lastFour: "4821", color: "SKY", icon: "star" };

    const renamed = await patch(ana, visa.id, { name: "Visa Gold" });
    expect(await renamed.json()).toMatchObject({ name: "Visa Gold", ...set });
    expect((await listOf(ana))[0]).toMatchObject({ name: "Visa Gold", ...set });

    const cleared = await patch(ana, visa.id, { institution: null, lastFour: null });
    expect(await cleared.json()).toMatchObject({
      institution: null,
      lastFour: null,
      color: "SKY",
      icon: "star",
    });
    expect((await listOf(ana))[0]).toMatchObject({
      institution: null,
      lastFour: null,
      color: "SKY",
      icon: "star",
    });
  });
});

describe("type-specific account attributes (HU-E2-06)", () => {
  it("creates a card with its terms, available credit and effective annual rate", async () => {
    const ana = await registerUser("Ana");
    const visa = await created(ana, {
      name: "Visa",
      type: "CREDIT_CARD",
      openingBalance: cop(-350_000),
      terms: { creditLimit: cop(5_000_000), cutOffDay: 20, paymentDay: 5, monthlyRate: "2.0" },
    });
    expect(visa.terms).toMatchObject({
      creditLimit: cop(5_000_000),
      cutOffDay: 20,
      paymentDay: 5,
      monthlyRate: "2.0000",
    });
    expect(visa.derived).toMatchObject({ availableCredit: cop(4_650_000), effectiveAnnualRate: "26.8242" });
  });

  it("creates a CDT with its start date and a loan with its equivalent monthly rate", async () => {
    const ana = await registerUser("Ana");
    const cdt = await created(ana, {
      name: "CDT Davivienda",
      type: "SAVINGS",
      openingBalance: cop(10_000_000),
      terms: { annualRate: "9.5", termDays: 180, maturityDate: "2027-04-14" },
    });
    expect(cdt.terms).toMatchObject({ annualRate: "9.5000", termDays: 180, maturityDate: "2027-04-14" });
    expect(cdt.derived).toMatchObject({ startDate: "2026-10-16" });
    const loan = await created(ana, {
      name: "Crédito libre inversión",
      type: "LOAN",
      openingBalance: cop(-20_000_000),
      terms: { principal: cop(20_000_000), annualRate: "18", termMonths: 36 },
    });
    expect(loan.derived).toMatchObject({ equivalentMonthlyRate: "1.3888" });
  });

  it.each([
    ["CREDIT_CARD", { cutOffDay: 32 }, "InvalidBillingDay"],
    ["CREDIT_CARD", { creditLimit: cop(0) }, "InvalidCreditLimit"],
    ["CREDIT_CARD", { monthlyRate: "-1" }, "InvalidRate"],
    ["SAVINGS", { termDays: 180 }, "InvalidTermDeposit"],
    ["SAVINGS", { termDays: 180, maturityDate: "1899-12-31" }, "InvalidDate"],
    ["LOAN", { termMonths: 0 }, "InvalidTerm"],
  ])("refuses a %s with %o: %s", async (type, terms, code) => {
    const ana = await registerUser("Ana");
    expect(await problemOf(await create(ana, { name: "X", type, openingBalance: cop(0), terms }))).toEqual([
      422,
      code,
    ]);
  });

  it("refuses a credit limit on a BANK account", async () => {
    const ana = await registerUser("Ana");
    const bank = await created(ana, { name: "Bancolombia", type: "BANK", openingBalance: cop(0) });
    expect(await problemOf(await patch(ana, bank.id, { terms: { creditLimit: cop(1_000_000) } }))).toEqual([
      409,
      "AccountAttributeNotAllowed",
    ]);
  });

  it("changes and clears terms on an update, keeping the ones it leaves out", async () => {
    const ana = await registerUser("Ana");
    const visa = await created(ana, {
      name: "Visa",
      type: "CREDIT_CARD",
      openingBalance: cop(-350_000),
      terms: { creditLimit: cop(5_000_000), cutOffDay: 20, paymentDay: 5, monthlyRate: "2.0" },
    });

    const raised = await patch(ana, visa.id, { terms: { creditLimit: cop(6_000_000), paymentDay: null } });
    expect(raised.status).toBe(200);
    const card = (await raised.json()) as AccountDto;
    expect(card.terms).toMatchObject({
      creditLimit: cop(6_000_000),
      cutOffDay: 20,
      paymentDay: null,
      monthlyRate: "2.0000",
    });
    expect(card.derived).toMatchObject({ availableCredit: cop(5_650_000), nextPaymentDate: null });

    const cleared = await patch(ana, visa.id, { terms: { monthlyRate: null } });
    expect(((await cleared.json()) as AccountDto).derived).toMatchObject({ effectiveAnnualRate: null });
    expect((await listOf(ana))[0]?.terms).toMatchObject({
      creditLimit: cop(6_000_000),
      cutOffDay: 20,
      paymentDay: null,
      monthlyRate: null,
    });
  });

  it("clears a credit limit with null, and the available credit with it", async () => {
    const ana = await registerUser("Ana");
    const visa = await created(ana, {
      name: "Visa",
      type: "CREDIT_CARD",
      openingBalance: cop(-350_000),
      terms: { creditLimit: cop(5_000_000), cutOffDay: 20 },
    });

    const cleared = await patch(ana, visa.id, { terms: { creditLimit: null } });
    expect(cleared.status).toBe(200);
    const card = (await cleared.json()) as AccountDto;
    expect(card.terms).toMatchObject({ creditLimit: null, cutOffDay: 20 });
    expect(card.derived).toMatchObject({ availableCredit: null });
    expect((await listOf(ana))[0]).toMatchObject({
      terms: { creditLimit: null, cutOffDay: 20 },
      derived: { availableCredit: null },
    });
  });

  it.each([
    ["CREDIT_CARD", "creditLimit"],
    ["LOAN", "principal"],
  ])(
    "refuses a %s %s beyond what the database holds, answering 422 and storing nothing",
    async (type, field) => {
      const ana = await registerUser("Ana");
      const oversized = { amount: "9223372036854775808", currency: "COP" };
      const response = await create(ana, {
        name: "X",
        type,
        openingBalance: cop(0),
        terms: { [field]: oversized },
      });
      expect(await problemOf(response)).toEqual([422, "ValidationFailed"]);
      expect(await listOf(ana)).toEqual([]);
    },
  );

  it.each([
    ["CREDIT_CARD", "monthlyRate", 2, "ValidationFailed"],
    ["CREDIT_CARD", "monthlyRate", "2.12345", "InvalidRate"],
    ["CREDIT_CARD", "monthlyRate", "-1", "InvalidRate"],
    ["CREDIT_CARD", "monthlyRate", "100.0001", "InvalidRate"],
    ["CREDIT_CARD", "monthlyRate", "2,5", "InvalidRate"],
    ["SAVINGS", "annualRate", 9.5, "ValidationFailed"],
    ["SAVINGS", "annualRate", "9.12345", "InvalidRate"],
    ["LOAN", "annualRate", "-18", "InvalidRate"],
    ["LOAN", "annualRate", "100.0001", "InvalidRate"],
  ])("refuses a %s %s of %j with %s, storing nothing", async (type, field, value, code) => {
    const ana = await registerUser("Ana");
    const response = await create(ana, {
      name: "X",
      type,
      openingBalance: cop(0),
      terms: { [field]: value },
    });
    expect(await problemOf(response)).toEqual([422, code]);
    expect(await listOf(ana)).toEqual([]);
  });

  it("accepts a rate of up to 100 % with up to four decimals", async () => {
    const ana = await registerUser("Ana");
    const visa = await created(ana, {
      name: "Visa",
      type: "CREDIT_CARD",
      openingBalance: cop(0),
      terms: { monthlyRate: "100" },
    });
    expect(visa.terms).toMatchObject({ monthlyRate: "100.0000" });
    const loan = await created(ana, {
      name: "Préstamo",
      type: "LOAN",
      openingBalance: cop(0),
      terms: { annualRate: "7.1234" },
    });
    expect(loan.terms).toMatchObject({ annualRate: "7.1234" });
  });

  it.each([
    ["monthlyRate", "BANK", "2.0"],
    ["annualRate", "CREDIT_CARD", "9.5"],
    ["creditLimit", "SAVINGS", cop(1_000_000)],
  ])("names %s, as the key inside terms, when a %s account refuses it", async (field, type, value) => {
    const ana = await registerUser("Ana");
    const refused = {
      type: "urn:hearth:problem:AccountAttributeNotAllowed",
      title: "Conflict",
      status: 409,
      code: "AccountAttributeNotAllowed",
      requestId: expect.any(String),
      field,
    };

    const onCreate = await create(ana, {
      name: "X",
      type,
      openingBalance: cop(0),
      terms: { [field]: value },
    });
    expect(onCreate.status).toBe(409);
    expect(await onCreate.json()).toEqual(refused);

    const account = await created(ana, { name: "Y", type, openingBalance: cop(0) });
    const onUpdate = await patch(ana, account.id, { terms: { [field]: value } });
    expect(onUpdate.status).toBe(409);
    expect(await onUpdate.json()).toEqual(refused);
  });
});
