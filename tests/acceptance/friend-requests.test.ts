import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getMe, PATCH as updateMe } from "@/app/api/v1/me/route";
import { GET as findByHandle } from "@/app/api/v1/users/by-handle/[handle]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** A handle no other test (or file) uses: the prefix, an underscore and eight hex digits. */
const freshHandle = (prefix: string): string => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;

const setHandle = (user: TestUser, handle: string | null) =>
  call(updateMe, "PATCH", "/api/v1/me", { user, body: { handle } });

/** A registered person with a handle of their own. */
const person = async (name: string): Promise<TestUser & { handle: string }> => {
  const user = await registerUser(name);
  const handle = freshHandle(name.toLowerCase());
  const response = await setHandle(user, handle);
  expect(response.status).toBe(200);
  return { ...user, handle };
};

const lookup = (user: TestUser, handle: string) =>
  call(findByHandle, "GET", `/api/v1/users/by-handle/${encodeURIComponent(handle)}`, {
    user,
    params: { handle },
  });

describe("@usuario: a unique handle on the profile (P339, S2)", () => {
  it("sets, shows, changes and clears the handle; upper case is stored in lower case", async () => {
    const ana = await registerUser("Ana");
    const handle = freshHandle("ana");
    const set = await setHandle(ana, `@${handle.toUpperCase()}`);
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({ handle });
    const me = await call(getMe, "GET", "/api/v1/me", { user: ana });
    expect(await me.json()).toMatchObject({ handle });
    const other = freshHandle("anita");
    expect(await (await setHandle(ana, other)).json()).toMatchObject({ handle: other });
    const cleared = await setHandle(ana, null);
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).not.toHaveProperty("handle");
    // The old handle is free again.
    expect(await problemOf(await lookup(await registerUser("Eva"), other))).toEqual([404, "UserNotFound"]);
  });

  it("a person without a handle reads a profile without one (additive only)", async () => {
    const ana = await registerUser("Ana");
    expect(await (await call(getMe, "GET", "/api/v1/me", { user: ana })).json()).not.toHaveProperty("handle");
  });

  it("refuses a handle someone else holds, whatever its case, and keeps the person's own", async () => {
    const ana = await person("Ana");
    const bruno = await person("Bruno");
    expect(await problemOf(await setHandle(bruno, ana.handle.toUpperCase()))).toEqual([409, "HandleTaken"]);
    // Setting her own handle again is no change.
    expect((await setHandle(ana, ana.handle)).status).toBe(200);
    expect(await (await call(getMe, "GET", "/api/v1/me", { user: bruno })).json()).toMatchObject({
      handle: bruno.handle,
    });
  });

  it("refuses handles that are too short, too long or carry other characters, and writes nothing", async () => {
    const ana = await person("Ana");
    for (const bad of ["ab", "a".repeat(21), "ana-maria", "ana maria", "añá_1", ""]) {
      expect(await problemOf(await setHandle(ana, bad))).toEqual([422, "InvalidHandle"]);
    }
    const both = await call(updateMe, "PATCH", "/api/v1/me", {
      user: ana,
      body: { handle: "x", timezone: "Europe/Madrid" },
    });
    expect(await problemOf(both)).toEqual([422, "InvalidHandle"]);
    expect(await (await call(getMe, "GET", "/api/v1/me", { user: ana })).json()).toMatchObject({
      handle: ana.handle,
      timezone: "America/Bogota",
    });
  });
});

describe("Lookup by the exact @ (P339, S3)", () => {
  it("answers only the handle and the display name, ignoring case and a leading @", async () => {
    const ana = await person("Ana");
    const bruno = await person("Bruno");
    const found = await lookup(ana, `@${bruno.handle.toUpperCase()}`);
    expect(found.status).toBe(200);
    expect(await found.json()).toStrictEqual({ handle: bruno.handle, displayName: "Bruno" });
  });

  it("is UserNotFound for a prefix, an unknown or malformed handle and the caller's own", async () => {
    const ana = await person("Ana");
    const bruno = await person("Bruno");
    for (const handle of [bruno.handle.slice(0, -1), freshHandle("nadie"), "no", "x!x", ana.handle]) {
      expect(await problemOf(await lookup(ana, handle))).toEqual([404, "UserNotFound"]);
    }
  });

  it("needs a session", async () => {
    const bruno = await person("Bruno");
    const response = await call(findByHandle, "GET", `/api/v1/users/by-handle/${bruno.handle}`, {
      params: { handle: bruno.handle },
    });
    expect(response.status).toBe(401);
  });
});
