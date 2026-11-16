import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getMe, PATCH as patchMe } from "@/app/api/v1/me/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";

// D29, slice MC4 (design §4): a person's display currency is the currency of their totals and unified view; absent
// means their personal space's currency. It rides on the profile `GET`/`PATCH /api/v1/me` answers, as an added field.
let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface Me {
  preferences: { displayCurrency?: string };
}
const me = async (user: TestUser) => (await (await call(getMe, "GET", "/api/v1/me", { user })).json()) as Me;
const patch = (user: TestUser, body: Record<string, unknown>) =>
  call(patchMe, "PATCH", "/api/v1/me", { user, body });

describe("display currency (D29, slice MC4)", () => {
  it("is absent by default, so the person follows their personal space's currency", async () => {
    const ana = await registerUser("Ana");
    expect((await me(ana)).preferences.displayCurrency).toBeUndefined();
  });

  it("stores a chosen ISO 4217 currency and shows it back", async () => {
    const ana = await registerUser("Ana");
    const changed = await patch(ana, { displayCurrency: "USD" });
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as Me).preferences.displayCurrency).toBe("USD");
    expect((await me(ana)).preferences.displayCurrency).toBe("USD");
  });

  it("clears it when set to null, back to their personal space's currency", async () => {
    const ana = await registerUser("Ana");
    expect((await patch(ana, { displayCurrency: "EUR" })).status).toBe(200);
    expect((await patch(ana, { displayCurrency: null })).status).toBe(200);
    expect((await me(ana)).preferences.displayCurrency).toBeUndefined();
  });

  it("refuses an unknown currency with 422 and keeps what is stored", async () => {
    const ana = await registerUser("Ana");
    expect((await patch(ana, { displayCurrency: "USD" })).status).toBe(200);
    // A three-letter code that is not a known currency reaches the use case and is refused there.
    expect(await problemOf(await patch(ana, { displayCurrency: "XYZ" }))).toEqual([422, "UnknownCurrency"]);
    // A code of the wrong length never passes the contract's shape check.
    expect((await patch(ana, { displayCurrency: "US" })).status).toBe(422);
    expect((await me(ana)).preferences.displayCurrency).toBe("USD");
  });
});
