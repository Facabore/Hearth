import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
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
      body: { name: "Bancolombia", type: "BANK", openingBalance: { amount: "0", currency: "COP" } },
    });
    const locked = await patch(ana, { currency: "USD" });
    expect([locked.status, (await locked.json()).code]).toEqual([409, "SpaceCurrencyLocked"]);
    const fresh = await registerUser("Luis");
    expect((await (await patch(fresh, { currency: "USD" })).json()).currency).toBe("USD");
    const unknown = await patch(fresh, { currency: "XYZ" });
    expect([unknown.status, (await unknown.json()).code]).toEqual([422, "UnknownCurrency"]);
  });

  it("hides another user's space", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const response = await patch(juan, { name: "Mine" }, ana.spaceId);
    expect([response.status, (await response.json()).code]).toEqual([404, "SpaceNotFound"]);
  });
});
