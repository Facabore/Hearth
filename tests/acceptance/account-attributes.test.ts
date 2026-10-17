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
      color: "pine",
      icon: "wallet",
    });
    expect(nequi).toMatchObject({
      type: "WALLET",
      institution: "Nequi",
      lastFour: "4821",
      color: "pine",
      icon: "wallet",
    });
    expect((await listOf(ana)).map((a) => a.id)).toEqual([nequi.id]);
  });

  it("gives attributes left out the type defaults", async () => {
    const ana = await registerUser("Ana");
    const cash = await created(ana, { name: "Efectivo", type: "CASH", openingBalance: cop(0) });
    expect([cash.icon, cash.institution, cash.lastFour, cash.color]).toEqual(["banknote", null, null, null]);
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
      color: "pine",
      icon: "gem",
    });
    expect(await (await patch(ana, nequi.id, { color: "ember", icon: null })).json()).toMatchObject({
      color: "ember",
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
      color: "sky",
      icon: "gem",
    });
    const set = { institution: "Bancolombia", lastFour: "4821", color: "sky", icon: "gem" };

    const renamed = await patch(ana, visa.id, { name: "Visa Gold" });
    expect(await renamed.json()).toMatchObject({ name: "Visa Gold", ...set });
    expect((await listOf(ana))[0]).toMatchObject({ name: "Visa Gold", ...set });

    const cleared = await patch(ana, visa.id, { institution: null, lastFour: null });
    expect(await cleared.json()).toMatchObject({
      institution: null,
      lastFour: null,
      color: "sky",
      icon: "gem",
    });
    expect((await listOf(ana))[0]).toMatchObject({
      institution: null,
      lastFour: null,
      color: "sky",
      icon: "gem",
    });
  });
});
