import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as signUp } from "@/app/api/v1/auth/sign-up/route";
import { POST as directSplit } from "@/app/api/v1/direct-splits/route";
import { GET as listAccounts } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import { PATCH as updateAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/route";
import { POST as archiveAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/archive/route";
import { POST as createStarterAccounts } from "@/app/api/v1/spaces/[spaceId]/accounts/starter/route";
import { PATCH as updateSpace } from "@/app/api/v1/spaces/[spaceId]/route";
import { GET as listSpaces } from "@/app/api/v1/spaces/route";
import { setContainerForTests, type Container } from "@/composition/container";
import {
  apiRequest,
  call,
  cookieHeader,
  problemOf,
  registerUser,
  startTestApp,
  uniqueEmail,
  type TestUser,
} from "../support/app";
import { categoryWithKey, cop, memberIdOf } from "../support/ledger";
import { endRecurrence, postRecurrence } from "../support/recurrences";
import { actingIn, joinAs, newSharedSpace } from "../support/spaces";

interface AccountDto {
  id: string;
  name: string;
  type: string;
  ownerUserId: string | null;
  openingBalance: { amount: string; currency: string };
  balance: { amount: string; currency: string };
  archivedAt: string | null;
  institution: string | null;
  lastFour: string | null;
  color: string | null;
  icon: string;
  includeInAvailable: boolean;
  includeInNetWorth: boolean;
}

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const zero = { amount: "0", currency: "COP" };
const accountsOf = async (user: TestUser, query = "?archived=true") => {
  const response = await call(listAccounts, "GET", `/api/v1/spaces/${user.spaceId}/accounts${query}`, {
    user,
    params: { spaceId: user.spaceId },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    items: AccountDto[];
    totals: { available: unknown; netWorth: unknown };
  };
};
const starter = (user: TestUser | undefined, spaceId: string) =>
  call(createStarterAccounts, "POST", `/api/v1/spaces/${spaceId}/accounts/starter`, {
    user,
    params: { spaceId },
  });
/** Signs a person up with `locale`, as the sign-up form sends it (ruling P142). */
const registerIn = async (locale: string): Promise<TestUser> => {
  const email = uniqueEmail("marta");
  const created = await signUp(
    apiRequest("POST", "/api/v1/auth/sign-up", {
      body: { name: "Marta", email, password: "123456789012", locale },
    }),
  );
  expect(created.status).toBe(201);
  const cookie = cookieHeader(created);
  const { user } = (await created.json()) as { user: { id: string } };
  const spaces = await listSpaces(apiRequest("GET", "/api/v1/spaces", { headers: { cookie } }));
  const { items } = (await spaces.json()) as { items: { id: string }[] };
  return { cookie, userId: user.id, spaceId: items[0]!.id, email };
};
const byName = (items: readonly AccountDto[]) =>
  items.map((a) => [a.name, a.type]).sort(([a], [b]) => a!.localeCompare(b!));

describe("starter accounts at sign-up (issue 169)", () => {
  it("opens exactly the five Spanish starter accounts at zero in the personal space, ready to use", async () => {
    const ana = await registerUser("Ana");
    const { items, totals } = await accountsOf(ana);
    expect(byName(items)).toEqual([
      ["Ahorros", "SAVINGS"],
      ["Billetera digital", "WALLET"],
      ["Cuenta bancaria", "BANK"],
      ["Efectivo", "CASH"],
      ["Tarjeta de crédito", "CREDIT_CARD"],
    ]);
    for (const account of items) {
      expect(account).toMatchObject({
        ownerUserId: ana.userId,
        openingBalance: zero,
        balance: zero,
        archivedAt: null,
        institution: null,
        lastFour: null,
        color: null,
      });
    }
    // Each type's default switches (HU-E2-07): cards and savings stay out of the available money.
    const switches = Object.fromEntries(
      items.map((a) => [a.type, [a.includeInAvailable, a.includeInNetWorth]]),
    );
    expect(switches).toEqual({
      CASH: [true, true],
      BANK: [true, true],
      WALLET: [true, true],
      CREDIT_CARD: [false, true],
      SAVINGS: [false, true],
    });
    expect(totals).toEqual({ available: zero, netWorth: zero });
  });

  it("names them in English when the person signs up in English", async () => {
    const marta = await registerIn("en");
    expect(byName((await accountsOf(marta)).items)).toEqual([
      ["Bank account", "BANK"],
      ["Cash", "CASH"],
      ["Credit card", "CREDIT_CARD"],
      ["Digital wallet", "WALLET"],
      ["Savings", "SAVINGS"],
    ]);
  });

  it("leaves the personal currency free to change: the starter accounts record no money and follow it (HU-E1-03)", async () => {
    const ana = await registerUser("Ana");
    const dollars = await call(updateSpace, "PATCH", `/api/v1/spaces/${ana.spaceId}`, {
      user: ana,
      params: { spaceId: ana.spaceId },
      body: { currency: "USD" },
    });
    expect(dollars.status).toBe(200);
    expect(((await dollars.json()) as { currency: string }).currency).toBe("USD");
    const { items, totals } = await accountsOf(ana);
    expect(items).toHaveLength(5);
    const usd = { amount: "0", currency: "USD" };
    for (const account of items) expect([account.openingBalance, account.balance]).toEqual([usd, usd]);
    expect(totals).toEqual({ available: usd, netWorth: usd });
  });

  it("locks the currency once a recurrence exists, and still once it ended (HU-E1-03)", async () => {
    const ana = await registerUser("Ana");
    const cash = (await accountsOf(ana)).items.find((a) => a.type === "CASH")!;
    const defined = await postRecurrence(ana, ana.spaceId, {
      description: "Gym",
      amount: cop(100_000),
      template: {
        type: "EXPENSE",
        categoryId: await categoryWithKey(ana, "groceries"),
        payer: { memberId: await memberIdOf(ana, ana.spaceId, "Ana"), accountId: cash.id },
      },
      schedule: { kind: "MONTHLY", day: 5 },
      mode: "AUTO",
      startDate: "2030-01-05",
    });
    expect(defined.status).toBe(201);
    const toDollars = () =>
      call(updateSpace, "PATCH", `/api/v1/spaces/${ana.spaceId}`, {
        user: ana,
        params: { spaceId: ana.spaceId },
        body: { currency: "USD" },
      });
    expect(await problemOf(await toDollars())).toEqual([409, "SpaceCurrencyLocked"]);
    // An ended recurrence keeps its amount in its own currency and can be extended again (#115).
    const { id } = (await defined.json()) as { id: string };
    expect((await endRecurrence(ana, ana.spaceId, id)).status).toBe(200);
    expect(await problemOf(await toDollars())).toEqual([409, "SpaceCurrencyLocked"]);
  });

  it("gives a shared space and a direct space no accounts", async () => {
    const ana = await registerUser("Ana");
    const household = actingIn(ana, await newSharedSpace(ana));
    expect((await accountsOf(household)).items).toEqual([]);
    const cash = (await accountsOf(ana)).items.find((a) => a.name === "Efectivo")!;
    const split = await call(directSplit, "POST", "/api/v1/direct-splits", {
      user: ana,
      body: {
        counterpart: { kind: "GUEST", displayName: "Pedro" },
        description: "Almuerzo",
        date: "2026-10-14",
        categoryKey: "restaurants",
        amount: { amount: "12000000", currency: "COP" },
        accountId: cash.id,
      },
    });
    expect(split.status).toBe(201);
    const { spaceId } = (await split.json()) as { spaceId: string };
    expect((await accountsOf(actingIn(ana, spaceId))).items).toEqual([]);
  });
});

describe("creating the starter accounts from the Accounts screen (issue 169)", () => {
  it("creates only the starter names the space does not hold, and nothing on a second call", async () => {
    const ana = await registerUser("Ana");
    const { items } = await accountsOf(ana);
    const cash = items.find((a) => a.name === "Efectivo")!;
    const renamed = await call(updateAccount, "PATCH", `/api/v1/spaces/${ana.spaceId}/accounts/${cash.id}`, {
      user: ana,
      params: { spaceId: ana.spaceId, accountId: cash.id },
      body: { name: "Bolsillo" },
    });
    expect(renamed.status).toBe(200);
    for (const account of items.filter((a) => a.name !== "Efectivo")) {
      const archived = await call(
        archiveAccount,
        "POST",
        `/api/v1/spaces/${ana.spaceId}/accounts/${account.id}/archive`,
        { user: ana, params: { spaceId: ana.spaceId, accountId: account.id } },
      );
      expect(archived.status).toBe(200);
    }

    const first = await starter(ana, ana.spaceId);
    expect(first.status).toBe(200);
    const created = ((await first.json()) as { items: AccountDto[] }).items;
    // Archived accounts keep their names (HU-E2-01), so only "Efectivo" comes back.
    expect(created).toEqual([
      expect.objectContaining({ name: "Efectivo", type: "CASH", openingBalance: zero, archivedAt: null }),
    ]);
    expect((await accountsOf(ana)).items).toHaveLength(6);

    const second = await starter(ana, ana.spaceId);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ items: [] });
    expect((await accountsOf(ana)).items).toHaveLength(6);
  });

  it("answers 200 to parallel calls and creates each starter once", async () => {
    const ana = await registerUser("Ana");
    for (const account of (await accountsOf(ana)).items) {
      const renamed = await call(
        updateAccount,
        "PATCH",
        `/api/v1/spaces/${ana.spaceId}/accounts/${account.id}`,
        {
          user: ana,
          params: { spaceId: ana.spaceId, accountId: account.id },
          body: { name: `${account.name} viejo` },
        },
      );
      expect(renamed.status).toBe(200);
    }
    const results = await Promise.all([
      starter(ana, ana.spaceId),
      starter(ana, ana.spaceId),
      starter(ana, ana.spaceId),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const created = await Promise.all(
      results.map(async (r) => ((await r.json()) as { items: AccountDto[] }).items),
    );
    // Each starter comes back from exactly one of the calls.
    expect(
      created
        .flat()
        .map((a) => a.name)
        .sort(),
    ).toEqual(["Ahorros", "Billetera digital", "Cuenta bancaria", "Efectivo", "Tarjeta de crédito"]);
    expect((await accountsOf(ana)).items).toHaveLength(10);
  });

  it("refuses a shared space, even to its owner, and a member who does not manage it", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const spaceId = await newSharedSpace(ana);
    await joinAs(ana, spaceId, juan, "MEMBER");
    expect(await problemOf(await starter(ana, spaceId))).toEqual([
      409,
      "PersonalAccountRequiresPersonalSpace",
    ]);
    expect(await problemOf(await starter(juan, spaceId))).toEqual([403, "InsufficientRole"]);
    expect((await accountsOf(actingIn(ana, spaceId))).items).toEqual([]);
  });

  it("hides another person's space and requires authentication", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    expect(await problemOf(await starter(juan, ana.spaceId))).toEqual([404, "SpaceNotFound"]);
    expect((await starter(undefined, ana.spaceId)).status).toBe(401);
    expect((await accountsOf(ana)).items).toHaveLength(5);
  });
});
