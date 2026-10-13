import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listAccounts, POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import {
  GET as getAccount,
  PATCH as updateAccount,
} from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/route";
import { POST as archiveAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/archive/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, registerUser, startTestApp, type TestUser } from "../support/app";
import { actingIn, joinAs, newSharedSpace } from "../support/spaces";

interface AccountDto {
  id: string;
  name: string;
  type: string;
  ownerUserId: string | null;
  openingBalance: { amount: string; currency: string };
  balance: { amount: string; currency: string };
  archivedAt: string | null;
}

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const cop = (pesos: number) => ({ amount: String(pesos * 100), currency: "COP" });
const create = (user: TestUser, body: unknown) =>
  call(createAccount, "POST", `/api/v1/spaces/${user.spaceId}/accounts`, {
    user,
    params: { spaceId: user.spaceId },
    body,
  });
const list = async (user: TestUser, query = "") => {
  const response = await call(listAccounts, "GET", `/api/v1/spaces/${user.spaceId}/accounts${query}`, {
    user,
    params: { spaceId: user.spaceId },
  });
  return { status: response.status, body: await response.json() };
};
const accountCall = (
  handler: typeof getAccount,
  method: string,
  user: TestUser,
  account: AccountDto,
  body?: unknown,
  suffix = "",
) =>
  call(handler, method, `/api/v1/spaces/${user.spaceId}/accounts/${account.id}${suffix}`, {
    user,
    params: { spaceId: user.spaceId, accountId: account.id },
    body,
  });

describe("personal accounts (HU-E2-01)", () => {
  it("creates a bank account owned by Ana with its opening balance as balance", async () => {
    const ana = await registerUser("Ana");
    const response = await create(ana, { name: "Bancolombia", type: "BANK", openingBalance: cop(2_000_000) });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      name: "Bancolombia",
      type: "BANK",
      ownerUserId: ana.userId,
      openingBalance: cop(2_000_000),
      balance: cop(2_000_000),
      archivedAt: null,
    });
  });

  it("allows a credit card to start negative and answers rule violations with stable codes", async () => {
    const ana = await registerUser("Ana");
    const visa = await create(ana, { name: "Visa", type: "CREDIT_CARD", openingBalance: cop(-350_000) });
    expect((await visa.json()).openingBalance).toEqual(cop(-350_000));
    await create(ana, { name: "Bancolombia", type: "BANK", openingBalance: cop(0) });
    const cases: [unknown, number, string][] = [
      [{ name: "bancolombia", type: "SAVINGS", openingBalance: cop(0) }, 409, "AccountNameTaken"],
      [{ name: "Fund", type: "SHARED_FUND", openingBalance: cop(0) }, 409, "SharedFundRequiresSharedSpace"],
      [
        { name: "Chase", type: "BANK", openingBalance: { amount: "100", currency: "USD" } },
        422,
        "CurrencyMismatch",
      ],
      [
        { name: "Odd", type: "BANK", openingBalance: { amount: "100", currency: "XXX" } },
        422,
        "UnknownCurrency",
      ],
    ];
    for (const [body, status, code] of cases) {
      const response = await create(ana, body);
      expect([response.status, (await response.json()).code]).toEqual([status, code]);
    }
  });
});

describe("editing and archiving accounts (HU-E2-03)", () => {
  it("corrects the opening balance, keeps the type, archives and filters archived accounts", async () => {
    const ana = await registerUser("Ana");
    const bank = (await (
      await create(ana, { name: "Bancolombia", type: "BANK", openingBalance: cop(2_000_000) })
    ).json()) as AccountDto;
    const nequi = (await (
      await create(ana, { name: "Nequi", type: "CASH", openingBalance: cop(0) })
    ).json()) as AccountDto;

    const corrected = await accountCall(updateAccount, "PATCH", ana, bank, {
      openingBalance: cop(2_100_000),
    });
    expect((await corrected.json()).balance).toEqual(cop(2_100_000));
    const retyped = await accountCall(updateAccount, "PATCH", ana, bank, { type: "SAVINGS" });
    expect([retyped.status, (await retyped.json()).code]).toEqual([409, "AccountTypeImmutable"]);

    const archived = await accountCall(archiveAccount, "POST", ana, nequi, undefined, "/archive");
    expect((await archived.json()).archivedAt).toEqual(expect.any(String));
    expect((await list(ana)).body.items.map((a: AccountDto) => a.name)).toEqual(["Bancolombia"]);
    expect((await list(ana, "?archived=true")).body.items.map((a: AccountDto) => a.name)).toEqual([
      "Bancolombia",
      "Nequi",
    ]);
    expect((await accountCall(getAccount, "GET", ana, nequi)).status).toBe(200);
  });

  it("validates asOf and hides other users' spaces", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    // Zod's ISO date is calendar-aware, so impossible dates fail at the contract.
    expect(await list(ana, "?asOf=2026-02-30")).toMatchObject({
      status: 422,
      body: { code: "ValidationFailed" },
    });
    expect(await list(ana, "?asOf=yesterday")).toMatchObject({
      status: 422,
      body: { code: "ValidationFailed" },
    });
    expect((await list(ana, "?asOf=2026-10-31")).status).toBe(200);
    const foreign = await call(listAccounts, "GET", `/api/v1/spaces/${ana.spaceId}/accounts`, {
      user: juan,
      params: { spaceId: ana.spaceId },
    });
    expect(foreign.status).toBe(404);
  });
});

describe("shared fund account (HU-E2-02)", () => {
  it("lets the owner create the household fund, keeps members out and personal types away", async () => {
    // Background: "Ana" is OWNER and "Juan" is MEMBER of the shared space "Household".
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const spaceId = await newSharedSpace(ana);
    await joinAs(ana, spaceId, juan, "MEMBER");
    const asAna = actingIn(ana, spaceId);
    const fund = await create(asAna, { name: "Household Fund", type: "SHARED_FUND", openingBalance: cop(0) });
    expect(fund.status).toBe(201);
    const created = await fund.json();
    expect(created).toMatchObject({
      name: "Household Fund",
      type: "SHARED_FUND",
      ownerUserId: null,
      openingBalance: cop(0),
      balance: cop(0),
    });
    expect((await list(asAna)).body.items.map((a: AccountDto) => a.id)).toEqual([created.id]);
    const byJuan = await create(actingIn(juan, spaceId), {
      name: "Juan Fund",
      type: "SHARED_FUND",
      openingBalance: cop(0),
    });
    expect([byJuan.status, (await byJuan.json()).code]).toEqual([403, "InsufficientRole"]);
    const bank = await create(asAna, { name: "Bancolombia", type: "BANK", openingBalance: cop(0) });
    expect([bank.status, (await bank.json()).code]).toEqual([409, "PersonalAccountRequiresPersonalSpace"]);
  });
});
