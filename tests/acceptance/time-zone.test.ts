import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as signUp } from "@/app/api/v1/auth/sign-up/route";
import { GET as getMe, PATCH as patchMe } from "@/app/api/v1/me/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { apiRequest, call, cookieHeader, problemOf, startTestApp, uniqueEmail } from "../support/app";

let app: Container;
beforeAll(() => {
  app = startTestApp(); // APP_TIMEZONE is America/Bogota
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** Signs up over HTTP with an optional browser zone; returns the session cookie. */
const signedUp = async (name: string, timezone?: string) => {
  const response = await signUp(
    apiRequest("POST", "/api/v1/auth/sign-up", {
      body: { name, email: uniqueEmail(name.toLowerCase()), password: "123456789012", timezone },
    }),
  );
  expect(response.status).toBe(201);
  return cookieHeader(response);
};
const meOf = async (cookie: string) =>
  (await (await call(getMe, "GET", "/api/v1/me", { headers: { cookie } })).json()) as {
    id: string;
    timezone: string;
  };
const zoneOf = async (cookie: string) => (await meOf(cookie)).timezone;
const setZone = (cookie: string, timezone: string) =>
  call(patchMe, "PATCH", "/api/v1/me", { headers: { cookie }, body: { timezone } });

describe("user time zone (HU-E1-14)", () => {
  it("takes the browser's zone at sign-up", async () => {
    expect(await zoneOf(await signedUp("Juan", "Europe/Madrid"))).toBe("Europe/Madrid");
  });

  it("falls back to APP_TIMEZONE without a usable browser zone", async () => {
    expect(await zoneOf(await signedUp("Ana"))).toBe("America/Bogota");
    expect(await zoneOf(await signedUp("Luis", "Mars/Olympus"))).toBe("America/Bogota");
  });

  it("never blocks sign-up over a malformed browser zone", async () => {
    expect(await zoneOf(await signedUp("Eva", "x".repeat(65)))).toBe("America/Bogota");
  });

  it("changes my zone, and refuses an unknown one", async () => {
    const ana = await signedUp("Ana");
    const changed = await setZone(ana, "America/New_York");
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as { timezone: string }).timezone).toBe("America/New_York");
    expect(await zoneOf(ana)).toBe("America/New_York");
    expect(await problemOf(await setZone(ana, "Bogota"))).toEqual([422, "InvalidTimeZone"]);
    expect(await zoneOf(ana)).toBe("America/New_York");
  });

  it.each([
    ["an empty body", {}],
    ["only unknown keys", { nickname: "x" }],
  ])("changes nothing, and answers me, for %s", async (_label, body) => {
    const juan = await signedUp("Juan", "Europe/Madrid");
    const before = await meOf(juan);
    const response = await call(patchMe, "PATCH", "/api/v1/me", { headers: { cookie: juan }, body });
    expect(response.status).toBe(200);
    // Task 18b-1: GET answers `preferences`; PATCH answers the user alone until Task 18b-2 (which restores `before`).
    expect(await response.json()).toEqual({ ...before, preferences: undefined });
    expect(await meOf(juan)).toEqual(before);
  });

  it("reads a stored zone that Intl refuses as APP_TIMEZONE", async () => {
    const luis = await signedUp("Luis", "Europe/Madrid");
    await app.pool.query('UPDATE "user" SET timezone = $1 WHERE id = $2', [
      "Mars/Olympus",
      (await meOf(luis)).id,
    ]);
    expect(await zoneOf(luis)).toBe("America/Bogota");
  });

  it("needs a session", async () => {
    expect(
      await problemOf(await call(patchMe, "PATCH", "/api/v1/me", { body: { timezone: "UTC" } })),
    ).toEqual([401, "Unauthenticated"]);
  });
});
