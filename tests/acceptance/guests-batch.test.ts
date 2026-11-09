import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as addGuest } from "@/app/api/v1/spaces/[spaceId]/guests/route";
import { POST as addGuests } from "@/app/api/v1/spaces/[spaceId]/guests/batch/route";
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

/** P309 Background: "Household" with OWNER Ana, MEMBER Luis and VIEWER Sofi. */
const household = async () => {
  const ana = await registerUser("Ana");
  const luis = await registerUser("Luis");
  const sofi = await registerUser("Sofi");
  const spaceId = await newSharedSpace(ana);
  await joinAs(ana, spaceId, luis, "MEMBER");
  await joinAs(ana, spaceId, sofi, "VIEWER");
  return { spaceId, ana, luis, sofi };
};
const batch = (user: TestUser | undefined, spaceId: string, body: unknown) =>
  call(addGuests, "POST", `/api/v1/spaces/${spaceId}/guests/batch`, { user, params: { spaceId }, body });
const guestNames = async (spaceId: string) =>
  (
    await app.pool.query(
      "SELECT display_name FROM space_members WHERE space_id = $1 AND user_id IS NULL ORDER BY display_name",
      [spaceId],
    )
  ).rows.map((row: { display_name: string }) => row.display_name);

describe("several guests at once (P309)", () => {
  it("adds every guest in one request and answers them in the order given", async () => {
    const h = await household();
    const email = uniqueEmail("pedro");
    const response = await batch(h.luis, h.spaceId, {
      guests: [{ displayName: "Pedro", contactEmail: email }, { displayName: "Marta" }],
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      items: [
        {
          id: expect.any(String),
          kind: "GUEST",
          userId: null,
          displayName: "Pedro",
          role: null,
          contactEmail: email,
          joinedAt: expect.any(String),
        },
        {
          id: expect.any(String),
          kind: "GUEST",
          userId: null,
          displayName: "Marta",
          role: null,
          contactEmail: null,
          joinedAt: expect.any(String),
        },
      ],
    });
    expect(await guestNames(h.spaceId)).toEqual(["Marta", "Pedro"]);
  });

  it("adds nobody when one name is taken, and names that guest's index", async () => {
    const h = await household();
    const response = await batch(h.luis, h.spaceId, {
      guests: [{ displayName: "Pedro" }, { displayName: "ana" }, { displayName: "Marta" }],
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "MemberNameTaken", guest: 1 });
    expect(await guestNames(h.spaceId)).toEqual([]);
  });

  it("refuses the second of two equal names in the batch, and an invalid name, with their index", async () => {
    const h = await household();
    const twice = await batch(h.luis, h.spaceId, {
      guests: [{ displayName: "Pedro" }, { displayName: "PEDRO" }],
    });
    expect(await twice.json()).toMatchObject({ status: 409, code: "MemberNameTaken", guest: 1 });
    const blank = await batch(h.luis, h.spaceId, {
      guests: [{ displayName: "   " }, { displayName: "Marta" }],
    });
    expect(blank.status).toBe(422);
    expect(await blank.json()).toMatchObject({ code: "InvalidMemberName", guest: 0 });
    expect(await guestNames(h.spaceId)).toEqual([]);
  });

  it("keeps the single-guest answer without a guest index", async () => {
    const h = await household();
    await batch(h.luis, h.spaceId, { guests: [{ displayName: "Pedro" }] });
    const single = await call(addGuest, "POST", `/api/v1/spaces/${h.spaceId}/guests`, {
      user: h.luis,
      params: { spaceId: h.spaceId },
      body: { displayName: "pedro" },
    });
    const body = (await single.json()) as Record<string, unknown>;
    expect(body.code).toBe("MemberNameTaken");
    expect(body).not.toHaveProperty("guest");
  });

  it("takes 1 to 20 guests and validates each email", async () => {
    const h = await household();
    expect(await problemOf(await batch(h.luis, h.spaceId, { guests: [] }))).toEqual([
      422,
      "ValidationFailed",
    ]);
    const many = Array.from({ length: 21 }, (_, i) => ({ displayName: `Guest ${i}` }));
    expect(await problemOf(await batch(h.luis, h.spaceId, { guests: many }))).toEqual([
      422,
      "ValidationFailed",
    ]);
    expect(
      await problemOf(
        await batch(h.luis, h.spaceId, {
          guests: [{ displayName: "Lina" }, { displayName: "Ema", contactEmail: "no" }],
        }),
      ),
    ).toEqual([422, "ValidationFailed"]);
    expect(await guestNames(h.spaceId)).toEqual([]);
  });

  it("refuses a viewer, an anonymous caller and a personal space", async () => {
    const h = await household();
    const guests = [{ displayName: "Pedro" }];
    expect(await problemOf(await batch(h.sofi, h.spaceId, { guests }))).toEqual([403, "InsufficientRole"]);
    expect(await problemOf(await batch(undefined, h.spaceId, { guests }))).toEqual([401, "Unauthenticated"]);
    expect(await problemOf(await batch(h.ana, h.ana.spaceId, { guests }))).toEqual([
      409,
      "PersonalSpaceNotShareable",
    ]);
    expect(await guestNames(h.spaceId)).toEqual([]);
  });
});
