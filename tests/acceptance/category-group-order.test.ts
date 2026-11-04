import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listCategories } from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { POST as createGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/route";
import { POST as archiveGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/[groupId]/archive/route";
import { POST as moveGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/[groupId]/move/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { actingIn, joinAs, newSharedSpace } from "../support/spaces";

interface GroupDto {
  id: string;
  name: string;
  position?: number;
  archivedAt: string | null;
}

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const base = (user: TestUser) => `/api/v1/spaces/${user.spaceId}`;
const listed = async (user: TestUser, query = ""): Promise<GroupDto[]> =>
  (
    (await (
      await call(listCategories, "GET", `${base(user)}/categories${query}`, {
        user,
        params: { spaceId: user.spaceId },
      })
    ).json()) as { items: GroupDto[] }
  ).items;
const names = async (user: TestUser) => (await listed(user)).map((g) => g.name);
const idOf = async (user: TestUser, name: string) =>
  (await listed(user, "?archived=true")).find((g) => g.name === name)!.id;
const move = (user: TestUser, groupId: string, body: unknown) =>
  call(moveGroup, "POST", `${base(user)}/category-groups/${groupId}/move`, {
    user,
    params: { spaceId: user.spaceId, groupId },
    body,
  });
const STARTERS = ["Vivienda", "Alimentación", "Transporte", "Salud", "Ocio", "Ingresos"];

describe("the order of a space's category groups (#240, ruling P296)", () => {
  it("lists a new space's starter groups in board Categorías 01's order, each with its place", async () => {
    const ana = await registerUser("Ana");
    const groups = await listed(ana);
    expect(groups.map((g) => [g.name, g.position])).toEqual(STARTERS.map((name, i) => [name, i]));
  });

  it("puts a new group last", async () => {
    const ana = await registerUser("Ana");
    const response = await call(createGroup, "POST", `${base(ana)}/category-groups`, {
      user: ana,
      params: { spaceId: ana.spaceId },
      body: { name: "Mascotas" },
    });
    expect(await response.json()).toMatchObject({ name: "Mascotas", position: 6 });
    expect(await names(ana)).toEqual([...STARTERS, "Mascotas"]);
  });

  it("moves a group one place up and one place down, answering every group in its new order", async () => {
    const ana = await registerUser("Ana");
    const health = await idOf(ana, "Salud");

    const up = await move(ana, health, { before: await idOf(ana, "Transporte") });
    expect(up.status).toBe(200);
    const answered = ((await up.json()) as { items: GroupDto[] }).items;
    expect(answered.map((g) => [g.name, g.position])).toEqual([
      ["Vivienda", 0],
      ["Alimentación", 1],
      ["Salud", 2],
      ["Transporte", 3],
      ["Ocio", 4],
      ["Ingresos", 5],
    ]);
    expect(await names(ana)).toEqual(answered.map((g) => g.name));

    await move(ana, health, { after: await idOf(ana, "Transporte") });
    expect(await names(ana)).toEqual(STARTERS);
  });

  it("moves past a group another tab hides in one step, and keeps an archived group's place dense", async () => {
    const ana = await registerUser("Ana");
    const leisure = await idOf(ana, "Ocio");
    await call(archiveGroup, "POST", `${base(ana)}/category-groups/${leisure}/archive`, {
      user: ana,
      params: { spaceId: ana.spaceId, groupId: leisure },
    });
    await call(createGroup, "POST", `${base(ana)}/category-groups`, {
      user: ana,
      params: { spaceId: ana.spaceId },
      body: { name: "Mascotas" },
    });
    // Gastos hides Ingresos: Mascotas, last, goes right before Salud, the group above it on that tab.
    await move(ana, await idOf(ana, "Mascotas"), { before: await idOf(ana, "Salud") });
    expect(await names(ana)).toEqual([
      "Vivienda",
      "Alimentación",
      "Transporte",
      "Mascotas",
      "Salud",
      "Ingresos",
    ]);
    expect((await listed(ana, "?archived=true")).map((g) => g.position)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("refuses an archived group or anchor, an unknown one, and a body without exactly one anchor, and moves nothing", async () => {
    const ana = await registerUser("Ana");
    const leisure = await idOf(ana, "Ocio");
    const food = await idOf(ana, "Alimentación");
    await call(archiveGroup, "POST", `${base(ana)}/category-groups/${leisure}/archive`, {
      user: ana,
      params: { spaceId: ana.spaceId, groupId: leisure },
    });
    const before = await listed(ana, "?archived=true");
    expect(await problemOf(await move(ana, leisure, { before: food }))).toEqual([
      409,
      "CategoryGroupArchived",
    ]);
    expect(await problemOf(await move(ana, food, { after: leisure }))).toEqual([
      409,
      "CategoryGroupArchived",
    ]);
    expect(await problemOf(await move(ana, food, { after: crypto.randomUUID() }))).toEqual([
      404,
      "CategoryGroupNotFound",
    ]);
    expect(await problemOf(await move(ana, crypto.randomUUID(), { after: food }))).toEqual([
      404,
      "CategoryGroupNotFound",
    ]);
    expect(await problemOf(await move(ana, food, {}))).toEqual([422, "ValidationFailed"]);
    expect(await problemOf(await move(ana, food, { before: leisure, after: leisure }))).toEqual([
      422,
      "ValidationFailed",
    ]);
    expect(await listed(ana, "?archived=true")).toEqual(before);
  });

  it("lets whoever manages the tree move a group, and refuses a MEMBER and a VIEWER", async () => {
    const ana = await registerUser("Ana");
    const household = actingIn(ana, await newSharedSpace(ana));
    const [eva, leo, sofi] = [
      await registerUser("Eva"),
      await registerUser("Leo"),
      await registerUser("Sofi"),
    ];
    await joinAs(ana, household.spaceId, eva, "ADMIN");
    await joinAs(ana, household.spaceId, leo, "MEMBER");
    await joinAs(ana, household.spaceId, sofi, "VIEWER");
    const order = await names(household);
    const [first, second] = [await idOf(household, order[0]!), await idOf(household, order[1]!)];
    for (const refused of [leo, sofi])
      expect(
        await problemOf(await move(actingIn(refused, household.spaceId), second, { before: first })),
      ).toEqual([403, "InsufficientRole"]);
    expect(await names(household)).toEqual(order);
    expect((await move(actingIn(eva, household.spaceId), second, { before: first })).status).toBe(200);
    expect(await names(household)).toEqual([order[1], order[0], ...order.slice(2)]);
  });

  it("hides another user's space", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const food = await idOf(ana, "Alimentación");
    const housing = await idOf(ana, "Vivienda");
    expect(await problemOf(await move(actingIn(juan, ana.spaceId), food, { before: housing }))).toEqual([
      404,
      "SpaceNotFound",
    ]);
  });
});
