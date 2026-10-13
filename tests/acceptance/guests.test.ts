import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as signIn } from "@/app/api/v1/auth/sign-in/route";
import { POST as addGuest } from "@/app/api/v1/spaces/[spaceId]/guests/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, uniqueEmail, type TestUser } from "../support/app";
import { joinAs, newSharedSpace } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface Household {
  readonly spaceId: string;
  readonly ana: TestUser;
  readonly luis: TestUser;
  readonly sofi: TestUser;
}

/** HU-E1-10 Background: "Household" with OWNER Ana, MEMBER Luis and VIEWER Sofi. */
const household = async (): Promise<Household> => {
  const ana = await registerUser("Ana");
  const luis = await registerUser("Luis");
  const sofi = await registerUser("Sofi");
  const spaceId = await newSharedSpace(ana);
  await joinAs(ana, spaceId, luis, "MEMBER");
  await joinAs(ana, spaceId, sofi, "VIEWER");
  return { spaceId, ana, luis, sofi };
};
const add = (user: TestUser, spaceId: string, body: unknown) =>
  call(addGuest, "POST", `/api/v1/spaces/${spaceId}/guests`, { user, params: { spaceId }, body });

describe("guest members (HU-E1-10)", () => {
  it("lets a member add a guest with a contact email, with no user and no role", async () => {
    const h = await household();
    const email = uniqueEmail("pedro");
    const response = await add(h.luis, h.spaceId, { displayName: "Pedro", contactEmail: email });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: expect.any(String),
      kind: "GUEST",
      userId: null,
      displayName: "Pedro",
      role: null,
      contactEmail: email,
      joinedAt: expect.any(String),
    });
  });

  it("lists the guest among the current members", async () => {
    const h = await household();
    await add(h.luis, h.spaceId, { displayName: "Pedro" });
    const response = await call(listMembers, "GET", `/api/v1/spaces/${h.spaceId}/members`, {
      user: h.ana,
      params: { spaceId: h.spaceId },
    });
    const { items } = (await response.json()) as { items: { displayName: string; kind: string }[] };
    expect(items.map((m) => [m.displayName, m.kind])).toEqual([
      ["Ana", "USER"],
      ["Luis", "USER"],
      ["Sofi", "USER"],
      ["Pedro", "GUEST"],
    ]);
  });

  it("does not let a viewer add guests", async () => {
    const h = await household();
    expect(await problemOf(await add(h.sofi, h.spaceId, { displayName: "Pedro" }))).toEqual([
      403,
      "InsufficientRole",
    ]);
  });

  it("requires a display name unique among current members, ignoring case", async () => {
    const h = await household();
    expect((await add(h.luis, h.spaceId, { displayName: "Pedro" })).status).toBe(201);
    expect(await problemOf(await add(h.luis, h.spaceId, { displayName: "pedro" }))).toEqual([
      409,
      "MemberNameTaken",
    ]);
    expect(await problemOf(await add(h.luis, h.spaceId, { displayName: "ANA" }))).toEqual([
      409,
      "MemberNameTaken",
    ]);
    expect(await problemOf(await add(h.luis, h.spaceId, { displayName: "   " }))).toEqual([
      422,
      "InvalidMemberName",
    ]);
    expect(
      await problemOf(await add(h.luis, h.spaceId, { displayName: "Lina", contactEmail: "nope" })),
    ).toEqual([422, "ValidationFailed"]);
  });

  it("gives the guest no sign-in, no user and therefore no personal space (Review Focus 4)", async () => {
    const h = await household();
    const email = uniqueEmail("pedro");
    await add(h.luis, h.spaceId, { displayName: "Pedro", contactEmail: email });
    const response = await call(signIn, "POST", "/api/v1/auth/sign-in", {
      body: { email, password: "any-password-123" },
    });
    expect(await problemOf(response)).toEqual([401, "InvalidCredentials"]);
    const users = await app.pool.query('SELECT count(*)::int AS n FROM "user" WHERE email = $1', [email]);
    expect(users.rows[0].n).toBe(0);
    const rows = await app.pool.query("SELECT user_id, role FROM space_members WHERE contact_email = $1", [
      email,
    ]);
    expect(rows.rows).toEqual([{ user_id: null, role: null }]);
  });

  it("refuses guests in a personal space", async () => {
    const ana = await registerUser("Ana");
    expect(await problemOf(await add(ana, ana.spaceId, { displayName: "Pedro" }))).toEqual([
      409,
      "PersonalSpaceNotShareable",
    ]);
  });
});
