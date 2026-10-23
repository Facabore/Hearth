import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import { POST as archiveAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/archive/route";
import { GET as listPeriods } from "@/app/api/v1/spaces/[spaceId]/periods/route";
import { GET as getSpace, PATCH as updateSpace } from "@/app/api/v1/spaces/[spaceId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, registerUser, startTestApp, type TestUser } from "../support/app";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const patch = (user: TestUser, body: unknown, spaceId = user.spaceId) =>
  call(updateSpace, "PATCH", `/api/v1/spaces/${spaceId}`, { user, params: { spaceId }, body });
const periods = async (user: TestUser, query: string) => {
  const response = await call(listPeriods, "GET", `/api/v1/spaces/${user.spaceId}/periods${query}`, {
    user,
    params: { spaceId: user.spaceId },
  });
  return ((await response.json()) as { items: unknown[] }).items;
};

describe("space settings (HU-E1-03)", () => {
  it("returns and renames the space", async () => {
    const ana = await registerUser("Ana");
    const current = await call(getSpace, "GET", `/api/v1/spaces/${ana.spaceId}`, {
      user: ana,
      params: { spaceId: ana.spaceId },
    });
    expect(await current.json()).toMatchObject({ id: ana.spaceId, name: "Personal", role: "OWNER" });
    const renamed = await patch(ana, { name: "Casa" });
    expect([renamed.status, (await renamed.json()).name]).toEqual([200, "Casa"]);
  });

  it("switches to a cut-off on the 25th", async () => {
    const ana = await registerUser("Ana");
    expect((await patch(ana, { periodPolicy: { kind: "MONTHLY", day: 25 } })).status).toBe(200);
    expect(await periods(ana, "?from=2026-10-24&count=1")).toEqual([
      { label: "2026-10", startDate: "2026-09-25", endDate: "2026-10-24" },
    ]);
  });

  it("switches to semi-monthly periods on the 5th and 20th", async () => {
    const ana = await registerUser("Ana");
    await patch(ana, { periodPolicy: { kind: "SEMI_MONTHLY", day1: 5, day2: 20 } });
    expect(await periods(ana, "?from=2026-11-03&count=3")).toEqual([
      { label: "2026-10 H2", startDate: "2026-10-20", endDate: "2026-11-04" },
      { label: "2026-11 H1", startDate: "2026-11-05", endDate: "2026-11-19" },
      { label: "2026-11 H2", startDate: "2026-11-20", endDate: "2026-12-04" },
    ]);
  });

  it.each([
    { kind: "MONTHLY", day: 0 },
    { kind: "MONTHLY", day: 32 },
    { kind: "SEMI_MONTHLY", day1: 20, day2: 5 },
  ])("rejects %o with 422 InvalidPeriodPolicy", async (periodPolicy) => {
    const ana = await registerUser("Ana");
    const response = await patch(ana, { periodPolicy });
    expect([response.status, (await response.json()).code]).toEqual([422, "InvalidPeriodPolicy"]);
  });

  it("locks the currency once the space holds money records", async () => {
    const ana = await registerUser("Ana");
    await call(createAccount, "POST", `/api/v1/spaces/${ana.spaceId}/accounts`, {
      user: ana,
      params: { spaceId: ana.spaceId },
      // Issue 169: an account records money once it holds an amount; one at zero, like a starter account, does not.
      body: { name: "Bancolombia", type: "BANK", openingBalance: { amount: "100000", currency: "COP" } },
    });
    const locked = await patch(ana, { currency: "USD" });
    expect([locked.status, (await locked.json()).code]).toEqual([409, "SpaceCurrencyLocked"]);
    const fresh = await registerUser("Luis");
    expect((await (await patch(fresh, { currency: "USD" })).json()).currency).toBe("USD");
    const unknown = await patch(fresh, { currency: "XYZ" });
    expect([unknown.status, (await unknown.json()).code]).toEqual([422, "UnknownCurrency"]);
  });

  describe("an account that holds an amount locks the currency, whatever its balance or state (issue 169)", () => {
    const pesos = (amount: string) => ({ amount, currency: "COP" });
    const lockedAfter = async (body: Record<string, unknown>, archive = false) => {
      const ana = await registerUser("Ana");
      const created = await call(createAccount, "POST", `/api/v1/spaces/${ana.spaceId}/accounts`, {
        user: ana,
        params: { spaceId: ana.spaceId },
        body,
      });
      expect(created.status).toBe(201);
      if (archive) {
        const { id } = (await created.json()) as { id: string };
        const archived = await call(
          archiveAccount,
          "POST",
          `/api/v1/spaces/${ana.spaceId}/accounts/${id}/archive`,
          {
            user: ana,
            params: { spaceId: ana.spaceId, accountId: id },
          },
        );
        expect(archived.status).toBe(200);
      }
      const response = await patch(ana, { currency: "USD" });
      return [response.status, (await response.json()).code];
    };

    it("a credit card with a limit at a zero balance", async () => {
      const card = { name: "Visa", type: "CREDIT_CARD", openingBalance: pesos("0") };
      expect(await lockedAfter({ ...card, terms: { creditLimit: pesos("500000000") } })).toEqual([
        409,
        "SpaceCurrencyLocked",
      ]);
    });

    it("a loan with a principal at a zero balance", async () => {
      const loan = { name: "Crédito", type: "LOAN", openingBalance: pesos("0") };
      expect(await lockedAfter({ ...loan, terms: { principal: pesos("1000000000") } })).toEqual([
        409,
        "SpaceCurrencyLocked",
      ]);
    });

    it("an archived account with a balance", async () => {
      const old = { name: "Viejo", type: "WALLET", openingBalance: pesos("100000") };
      expect(await lockedAfter(old, true)).toEqual([409, "SpaceCurrencyLocked"]);
    });
  });

  it("hides another user's space", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const response = await patch(juan, { name: "Mine" }, ana.spaceId);
    expect([response.status, (await response.json()).code]).toEqual([404, "SpaceNotFound"]);
  });
});
