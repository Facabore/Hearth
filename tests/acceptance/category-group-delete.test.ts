import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listCategories } from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { POST as createCategory } from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { POST as restoreCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/restore/route";
import { POST as createGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/route";
import {
  DELETE as deleteGroup,
  PATCH as renameGroup,
} from "@/app/api/v1/spaces/[spaceId]/category-groups/[groupId]/route";
import { POST as archiveGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/[groupId]/archive/route";
import { POST as restoreGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/[groupId]/restore/route";
import { setContainerForTests, type Container } from "@/composition/container";
import {
  call,
  problemOf,
  registerUser,
  startTestApp,
  type RouteHandler,
  type TestUser,
} from "../support/app";
import { household, joinHousehold, paysEqually } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface CategoryDto {
  id: string;
  name: string;
  archivedAt: string | null;
  deletedAt?: string;
  subcategories: CategoryDto[];
}
interface GroupDto {
  id: string;
  name: string;
  key: string | null;
  archivedAt: string | null;
  deletedAt?: string;
  categories: CategoryDto[];
}

const treeOf = async (user: TestUser, query = "") => {
  const response = await call(listCategories, "GET", `/api/v1/spaces/${user.spaceId}/categories${query}`, {
    user,
    params: { spaceId: user.spaceId },
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: GroupDto[] }).items;
};
const onGroup = (handler: RouteHandler, method: string, user: TestUser, groupId: string, suffix = "") =>
  call(handler, method, `/api/v1/spaces/${user.spaceId}/category-groups/${groupId}${suffix}`, {
    user,
    params: { spaceId: user.spaceId, groupId },
  });
const groupWithKey = async (user: TestUser, key: string) => (await treeOf(user)).find((g) => g.key === key)!;

describe("DELETE /api/v1/spaces/{spaceId}/category-groups/{groupId} (P347)", () => {
  it("deletes a group whose categories movements use, with 204, out of the tree, the pickers and the archived", async () => {
    const h = await household();
    const ana = h.ana;
    const food = await groupWithKey(ana, "food");
    await paysEqually(h.juan, 180_000, [h.ana.memberId, h.juan.memberId], h.groceries);

    const response = await onGroup(deleteGroup, "DELETE", ana, food.id);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");

    // The pickers read the active tree: the group and its categories are gone.
    const active = await treeOf(ana);
    expect(active.map((g) => g.id)).not.toContain(food.id);
    expect(active.flatMap((g) => g.categories).map((c) => c.id)).not.toContain(h.groceries);
    // The whole tree lists it last, archived and deleted, so history still names it; nothing else is deleted.
    const everything = await treeOf(ana, "?archived=true");
    expect(everything.at(-1)).toMatchObject({
      id: food.id,
      name: food.name,
      archivedAt: expect.any(String),
      deletedAt: expect.any(String),
    });
    expect(everything.at(-1)!.categories.find((c) => c.id === h.groceries)).toMatchObject({
      name: "Mercado",
      archivedAt: expect.any(String),
      deletedAt: expect.any(String),
    });
    expect(everything.slice(0, -1).some((g) => "deletedAt" in g)).toBe(false);
    expect(
      everything
        .slice(0, -1)
        .flatMap((g) => g.categories)
        .some((c) => "deletedAt" in c),
    ).toBe(false);
    // The rows stay (D8).
    const { rows } = await app.pool.query(
      "SELECT count(*)::integer AS n FROM categories WHERE group_id = $1 AND deleted_at IS NOT NULL",
      [food.id],
    );
    expect(rows[0].n).toBe(food.categories.length);
  });

  it("lets only the tree's managers delete, and answers a deleted or unknown group with 404", async () => {
    const h = await household();
    const food = await groupWithKey(h.ana, "food");
    const member = await onGroup(deleteGroup, "DELETE", h.juan, food.id);
    expect(await problemOf(member)).toEqual([403, "InsufficientRole"]);
    const viewer = await joinHousehold(h, "Sofi", "VIEWER");
    expect(await problemOf(await onGroup(deleteGroup, "DELETE", viewer, food.id))).toEqual([
      403,
      "InsufficientRole",
    ]);
    expect((await treeOf(h.ana)).map((g) => g.id)).toContain(food.id);

    expect((await onGroup(deleteGroup, "DELETE", h.ana, food.id)).status).toBe(204);
    for (const [handler, method, suffix] of [
      [deleteGroup, "DELETE", ""],
      [restoreGroup, "POST", "/restore"],
      [archiveGroup, "POST", "/archive"],
    ] as const) {
      const again = await onGroup(handler, method, h.ana, food.id, suffix);
      expect(await problemOf(again)).toEqual([404, "CategoryGroupNotFound"]);
    }
    const renamed = await call(
      renameGroup,
      "PATCH",
      `/api/v1/spaces/${h.spaceId}/category-groups/${food.id}`,
      {
        user: h.ana,
        params: { spaceId: h.spaceId, groupId: food.id },
        body: { name: "Comida" },
      },
    );
    expect(await problemOf(renamed)).toEqual([404, "CategoryGroupNotFound"]);
    const unknown = await onGroup(deleteGroup, "DELETE", h.ana, crypto.randomUUID());
    expect(await problemOf(unknown)).toEqual([404, "CategoryGroupNotFound"]);
    const restored = await call(
      restoreCategory,
      "POST",
      `/api/v1/spaces/${h.spaceId}/categories/${h.groceries}/restore`,
      { user: h.ana, params: { spaceId: h.spaceId, categoryId: h.groceries } },
    );
    expect(await problemOf(restored)).toEqual([404, "CategoryNotFound"]);
  });

  it("frees the group's name, and takes no new category nor movement in it", async () => {
    const ana = await registerUser("Ana");
    const food = await groupWithKey(ana, "food");
    expect((await onGroup(deleteGroup, "DELETE", ana, food.id)).status).toBe(204);

    const again = await call(createGroup, "POST", `/api/v1/spaces/${ana.spaceId}/category-groups`, {
      user: ana,
      params: { spaceId: ana.spaceId },
      body: { name: food.name },
    });
    expect(again.status).toBe(201);
    expect(((await again.json()) as GroupDto).id).not.toBe(food.id);
    const inDeleted = await call(createCategory, "POST", `/api/v1/spaces/${ana.spaceId}/categories`, {
      user: ana,
      params: { spaceId: ana.spaceId },
      body: { groupId: food.id, name: "Panadería" },
    });
    expect(await problemOf(inDeleted)).toEqual([404, "CategoryGroupNotFound"]);
  });
});
