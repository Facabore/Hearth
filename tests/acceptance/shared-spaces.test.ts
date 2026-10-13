import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listCategories } from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { GET as listSpaces, POST as createSpace } from "@/app/api/v1/spaces/route";
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

const create = (user: TestUser | undefined, body: unknown) =>
  call(createSpace, "POST", "/api/v1/spaces", { user, body });
const members = (user: TestUser, spaceId: string) =>
  call(listMembers, "GET", `/api/v1/spaces/${spaceId}/members`, { user, params: { spaceId } });
/** Category names per group name. */
const tree = async (user: TestUser, spaceId: string) => {
  const response = await call(listCategories, "GET", `/api/v1/spaces/${spaceId}/categories`, {
    user,
    params: { spaceId },
  });
  const { items } = (await response.json()) as { items: { name: string; categories: { name: string }[] }[] };
  return new Map(items.map((g) => [g.name, g.categories.map((c) => c.name)]));
};

describe("create a shared space (HU-E1-04)", () => {
  it("creates Household as SHARED with Ana as OWNER and seeds the default categories", async () => {
    const ana = await registerUser("Ana");
    const response = await create(ana, { kind: "SHARED", name: "Household", currency: "COP" });
    expect(response.status).toBe(201);
    const space = await response.json();
    expect(space).toEqual({
      id: expect.any(String),
      name: "Household",
      kind: "SHARED",
      currency: "COP",
      periodPolicy: { kind: "MONTHLY", day: 1 },
      role: "OWNER",
    });
    const listed = await (await call(listSpaces, "GET", "/api/v1/spaces", { user: ana })).json();
    expect(listed.items.map((s: { kind: string }) => s.kind)).toEqual(["PERSONAL", "SHARED"]);
    expect((await (await members(ana, space.id)).json()).items).toEqual([
      {
        id: expect.any(String),
        kind: "USER",
        userId: ana.userId,
        displayName: "Ana",
        role: "OWNER",
        contactEmail: null,
        joinedAt: expect.any(String),
      },
    ]);
    expect((await tree(ana, space.id)).get("Vivienda")).toEqual(["Arriendo", "Mantenimiento", "Servicios"]);
  });

  it("seeds English names when the creator's locale is en, and defaults the currency to COP (HU-E3-01)", async () => {
    const juan = await registerUser("Juan");
    await app.pool.query(`UPDATE "user" SET locale = 'en' WHERE id = $1`, [juan.userId]);
    const flat = await (await create(juan, { kind: "SHARED", name: "Flat" })).json();
    expect(flat.currency).toBe("COP");
    expect((await tree(juan, flat.id)).get("Housing")).toEqual(["Maintenance", "Rent", "Utilities"]);
  });

  it.each([
    [{ kind: "SHARED", name: "", currency: "COP" }, 422, "InvalidSpaceName"],
    [{ kind: "SHARED", name: "Household", currency: "XYZ" }, 422, "UnknownCurrency"],
    [{ kind: "SHARED", name: "Household", currency: "cop" }, 422, "ValidationFailed"],
    [{ kind: "DIRECT", name: "Ana & Pedro" }, 422, "ValidationFailed"],
    [{ kind: "PERSONAL" }, 409, "PersonalSpaceAlreadyExists"],
  ])("answers %o with %i %s", async (body, status, code) => {
    const ana = await registerUser("Ana");
    expect(await problemOf(await create(ana, body))).toEqual([status, code]);
  });

  it("requires authentication", async () => {
    expect(await problemOf(await create(undefined, { kind: "SHARED", name: "Household" }))).toEqual([
      401,
      "Unauthenticated",
    ]);
  });

  it("hides the members of a space the user does not belong to, also for malformed ids", async () => {
    const ana = await registerUser("Ana");
    const marta = await registerUser("Marta");
    const space = await (await create(ana, { kind: "SHARED", name: "Household" })).json();
    for (const spaceId of [space.id, "not-a-uuid"]) {
      expect(await problemOf(await members(marta, spaceId))).toEqual([404, "SpaceNotFound"]);
    }
  });
});
