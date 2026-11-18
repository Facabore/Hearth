import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getMe, PATCH as patchMe } from "@/app/api/v1/me/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";

// P342 (board 6): each person keeps an ordered list of favorite currencies, the ones a currency picker offers after the
// space's own. They ride on the profile `GET`/`PATCH /api/v1/me` answers, as an added field: absent until the person
// chooses some, when the app shows their personal space's currency as the first favorite.
let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface Me {
  timezone: string;
  preferences: { favoriteCurrencies?: string[]; displayCurrency?: string };
}
const me = async (user: TestUser) => (await (await call(getMe, "GET", "/api/v1/me", { user })).json()) as Me;
const patch = (user: TestUser, body: Record<string, unknown>) =>
  call(patchMe, "PATCH", "/api/v1/me", { user, body });

const TWENTY = [
  "COP",
  "USD",
  "EUR",
  "MXN",
  "BRL",
  "JPY",
  "GBP",
  "CAD",
  "AUD",
  "CHF",
  "CLP",
  "PEN",
  "ARS",
  "UYU",
  "CNY",
  "INR",
  "KRW",
  "SEK",
  "NOK",
  "DKK",
];

describe("favorite currencies (P342, S2)", () => {
  it("are absent until the person chooses some", async () => {
    const ana = await registerUser("Ana");
    expect((await me(ana)).preferences.favoriteCurrencies).toBeUndefined();
  });

  it("store an ordered list of ISO 4217 codes and show it back", async () => {
    const ana = await registerUser("Ana");
    const changed = await patch(ana, { favoriteCurrencies: ["COP", "usd", "EUR", "MXN"] });
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as Me).preferences.favoriteCurrencies).toEqual([
      "COP",
      "USD",
      "EUR",
      "MXN",
    ]);
    expect((await me(ana)).preferences.favoriteCurrencies).toEqual(["COP", "USD", "EUR", "MXN"]);
  });

  it("keep an empty list as a choice of its own", async () => {
    const ana = await registerUser("Ana");
    expect((await patch(ana, { favoriteCurrencies: ["USD"] })).status).toBe(200);
    expect((await patch(ana, { favoriteCurrencies: [] })).status).toBe(200);
    expect((await me(ana)).preferences.favoriteCurrencies).toEqual([]);
  });

  it("drop a repeated code, keeping its first place", async () => {
    const ana = await registerUser("Ana");
    expect((await patch(ana, { favoriteCurrencies: ["USD", "COP", "usd"] })).status).toBe(200);
    expect((await me(ana)).preferences.favoriteCurrencies).toEqual(["USD", "COP"]);
  });

  it("refuse an unknown currency with 422 UnknownCurrency and keep what is stored", async () => {
    const ana = await registerUser("Ana");
    expect((await patch(ana, { favoriteCurrencies: ["USD"] })).status).toBe(200);
    expect(await problemOf(await patch(ana, { favoriteCurrencies: ["EUR", "XYZ"] }))).toEqual([
      422,
      "UnknownCurrency",
    ]);
    // A code of the wrong length, or a list that is not one, never passes the contract's shape check.
    expect(await problemOf(await patch(ana, { favoriteCurrencies: ["US"] }))).toEqual([
      422,
      "ValidationFailed",
    ]);
    expect(await problemOf(await patch(ana, { favoriteCurrencies: "USD" }))).toEqual([
      422,
      "ValidationFailed",
    ]);
    expect((await me(ana)).preferences.favoriteCurrencies).toEqual(["USD"]);
  });

  it("hold at most 20, and refuse a longer list with 422", async () => {
    const ana = await registerUser("Ana");
    expect((await patch(ana, { favoriteCurrencies: TWENTY })).status).toBe(200);
    expect(await problemOf(await patch(ana, { favoriteCurrencies: [...TWENTY, "PLN"] }))).toEqual([
      422,
      "ValidationFailed",
    ]);
    expect((await me(ana)).preferences.favoriteCurrencies).toEqual(TWENTY);
  });

  it("leave the other profile fields as they were, and stay when another field changes", async () => {
    const ana = await registerUser("Ana");
    expect((await patch(ana, { favoriteCurrencies: ["EUR"] })).status).toBe(200);
    const changed = await patch(ana, { timezone: "Europe/Madrid", displayCurrency: "USD" });
    expect(changed.status).toBe(200);
    const body = (await changed.json()) as Me;
    expect([body.timezone, body.preferences.displayCurrency, body.preferences.favoriteCurrencies]).toEqual([
      "Europe/Madrid",
      "USD",
      ["EUR"],
    ]);
  });
});
