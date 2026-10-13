import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GET as listCategories,
  POST as createCategory,
} from "@/app/api/v1/spaces/[spaceId]/categories/route";
import {
  DELETE as deleteCategory,
  PATCH as updateCategory,
} from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/route";
import { POST as createGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/route";
import { PATCH as renameGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/[groupId]/route";
import { POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import { POST as archiveCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/archive/route";
import { POST as restoreCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/restore/route";
import { POST as archiveGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/[groupId]/archive/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { GET as getTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, registerUser, startTestApp, type RouteHandler, type TestUser } from "../support/app";

interface CategoryDto {
  id: string;
  groupId: string;
  name: string;
  key: string | null;
  archivedAt: string | null;
}
interface GroupDto {
  id: string;
  name: string;
  archivedAt: string | null;
  categories: CategoryDto[];
}

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const treeOf = (user: TestUser | undefined, spaceId: string, query = "") =>
  call(listCategories, "GET", `/api/v1/spaces/${spaceId}/categories${query}`, { user, params: { spaceId } });
const groupsIn = async (response: Response) => ((await response.json()) as { items: GroupDto[] }).items;

describe("default categories (HU-E3-01)", () => {
  it("seeds the Spanish tree into the personal space at sign-up", async () => {
    const ana = await registerUser("Ana");
    const response = await treeOf(ana, ana.spaceId);
    expect(response.status).toBe(200);
    const groups = await groupsIn(response);
    const names = (group: string) => groups.find((g) => g.name === group)?.categories.map((c) => c.name);
    expect(names("Vivienda")).toEqual(["Arriendo", "Mantenimiento", "Servicios"]);
    expect(names("Ingresos")).toEqual(["Otros ingresos", "Salario"]);
    expect(groups.flatMap((g) => g.categories)).toContainEqual(
      expect.objectContaining({ name: "Mercado", key: "groceries", archivedAt: null }),
    );
  });

  it("hides another user's space and malformed ids as SpaceNotFound (Review Focus 4)", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    for (const spaceId of [ana.spaceId, "not-a-uuid"]) {
      const response = await treeOf(juan, spaceId);
      expect(response.status).toBe(404);
      expect((await response.json()).code).toBe("SpaceNotFound");
    }
  });

  it("requires authentication", async () => {
    const ana = await registerUser("Ana");
    expect((await treeOf(undefined, ana.spaceId)).status).toBe(401);
  });
});

describe("managing the category tree (HU-E3-02)", () => {
  const helpers = (user: TestUser) => {
    const base = `/api/v1/spaces/${user.spaceId}`;
    const groups = async () => groupsIn(await treeOf(user, user.spaceId));
    return {
      base,
      group: async (name: string) => (await groups()).find((g) => g.name === name)!,
      category: async (name: string) =>
        (await groups()).flatMap((g) => g.categories).find((c) => c.name === name)!,
    };
  };

  it("creates groups and categories, renames and moves them", async () => {
    const ana = await registerUser("Ana");
    const { base, group, category } = helpers(ana);
    const params = { spaceId: ana.spaceId };

    const pets = await call(createGroup, "POST", `${base}/category-groups`, {
      user: ana,
      params,
      body: { name: "Mascotas" },
    });
    expect(pets.status).toBe(201);
    expect(await pets.json()).toMatchObject({ name: "Mascotas", archivedAt: null });

    const food = await group("Alimentación");
    const bakery = await call(createCategory, "POST", `${base}/categories`, {
      user: ana,
      params,
      body: { groupId: food.id, name: "Panadería" },
    });
    expect(bakery.status).toBe(201);
    expect(await bakery.json()).toMatchObject({ groupId: food.id, name: "Panadería", key: null });

    const leisure = await group("Ocio");
    const renamed = await call(renameGroup, "PATCH", `${base}/category-groups/${leisure.id}`, {
      user: ana,
      params: { ...params, groupId: leisure.id },
      body: { name: "Diversión" },
    });
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).name).toBe("Diversión");

    const pharmacy = await category("Farmacia");
    const moved = await call(updateCategory, "PATCH", `${base}/categories/${pharmacy.id}`, {
      user: ana,
      params: { ...params, categoryId: pharmacy.id },
      body: { groupId: food.id },
    });
    expect(await moved.json()).toMatchObject({ id: pharmacy.id, groupId: food.id, key: "pharmacy" });
  });

  it("answers tree violations with stable codes", async () => {
    const ana = await registerUser("Ana");
    const { base, group, category } = helpers(ana);
    const params = { spaceId: ana.spaceId };
    const food = await group("Alimentación");
    const mercado = await category("Mercado");
    const create = (body: unknown) =>
      call(createCategory, "POST", `${base}/categories`, { user: ana, params, body });

    const third = await create({ groupId: mercado.id, name: "Orgánico" });
    expect([third.status, (await third.json()).code]).toEqual([409, "CategoryDepthExceeded"]);
    const duplicate = await create({ groupId: food.id, name: "mercado" });
    expect([duplicate.status, (await duplicate.json()).code]).toEqual([409, "CategoryNameTaken"]);
    const blank = await create({ groupId: food.id, name: "   " });
    expect([blank.status, (await blank.json()).code]).toEqual([422, "InvalidCategoryName"]);
    const unknown = await create({ groupId: "nope", name: "Pan" });
    expect([unknown.status, (await unknown.json()).code]).toEqual([404, "CategoryGroupNotFound"]);
  });

  it("hides another user's space", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const response = await call(createGroup, "POST", `/api/v1/spaces/${ana.spaceId}/category-groups`, {
      user: juan,
      params: { spaceId: ana.spaceId },
      body: { name: "Mascotas" },
    });
    expect([response.status, (await response.json()).code]).toEqual([404, "SpaceNotFound"]);
  });
});

describe("retiring categories (HU-E3-03)", () => {
  const onCategory = (
    handler: RouteHandler,
    method: string,
    user: TestUser,
    categoryId: string,
    suffix = "",
  ) =>
    call(handler, method, `/api/v1/spaces/${user.spaceId}/categories/${categoryId}${suffix}`, {
      user,
      params: { spaceId: user.spaceId, categoryId },
    });
  const names = async (user: TestUser, query = "") =>
    (await groupsIn(await treeOf(user, user.spaceId, query))).flatMap((g) => g.categories).map((c) => c.name);
  const accountOf = async (user: TestUser) => {
    const response = await call(createAccount, "POST", `/api/v1/spaces/${user.spaceId}/accounts`, {
      user,
      params: { spaceId: user.spaceId },
      body: { name: "Bancolombia", type: "BANK", openingBalance: { amount: "0", currency: "COP" } },
    });
    return ((await response.json()) as { id: string }).id;
  };
  const spend = (user: TestUser, accountId: string, categoryId: string) =>
    call(recordExpense, "POST", `/api/v1/spaces/${user.spaceId}/expenses`, {
      user,
      params: { spaceId: user.spaceId },
      body: { amount: { amount: "4000000", currency: "COP" }, date: "2026-10-05", categoryId, accountId },
    });

  it("deletes a category without transactions", async () => {
    const ana = await registerUser("Ana");
    const food = (await groupsIn(await treeOf(ana, ana.spaceId))).find((g) => g.name === "Alimentación")!;
    const created = await call(createCategory, "POST", `/api/v1/spaces/${ana.spaceId}/categories`, {
      user: ana,
      params: { spaceId: ana.spaceId },
      body: { groupId: food.id, name: "Panadería" },
    });
    const bakery = (await created.json()) as CategoryDto;
    expect((await onCategory(deleteCategory, "DELETE", ana, bakery.id)).status).toBe(204);
    expect(await names(ana, "?archived=true")).not.toContain("Panadería");
  });

  it("keeps referenced categories: no delete, archive hides them, new expenses refused, restore brings them back", async () => {
    const ana = await registerUser("Ana");
    const accountId = await accountOf(ana);
    const mercado = (await groupsIn(await treeOf(ana, ana.spaceId)))
      .flatMap((g) => g.categories)
      .find((c) => c.key === "groceries")!;
    const expense = (await (await spend(ana, accountId, mercado.id)).json()) as { id: string };

    const refused = await onCategory(deleteCategory, "DELETE", ana, mercado.id);
    expect([refused.status, (await refused.json()).code]).toEqual([409, "CategoryInUse"]);

    const archived = await onCategory(archiveCategory, "POST", ana, mercado.id, "/archive");
    expect((await archived.json()).archivedAt).toEqual(expect.any(String));
    expect(await names(ana)).not.toContain("Mercado");
    expect(await names(ana, "?archived=true")).toContain("Mercado");
    const history = await call(
      getTransaction,
      "GET",
      `/api/v1/spaces/${ana.spaceId}/transactions/${expense.id}`,
      {
        user: ana,
        params: { spaceId: ana.spaceId, transactionId: expense.id },
      },
    );
    expect((await history.json()).categoryId).toBe(mercado.id);
    const blocked = await spend(ana, accountId, mercado.id);
    expect([blocked.status, (await blocked.json()).code]).toEqual([409, "CategoryArchived"]);

    const restored = await onCategory(restoreCategory, "POST", ana, mercado.id, "/restore");
    expect((await restored.json()).archivedAt).toBeNull();
    expect(await names(ana)).toContain("Mercado");
  });

  it("archives a group with all its categories", async () => {
    const ana = await registerUser("Ana");
    const leisure = (await groupsIn(await treeOf(ana, ana.spaceId))).find((g) => g.name === "Ocio")!;
    const response = await call(
      archiveGroup,
      "POST",
      `/api/v1/spaces/${ana.spaceId}/category-groups/${leisure.id}/archive`,
      {
        user: ana,
        params: { spaceId: ana.spaceId, groupId: leisure.id },
      },
    );
    expect((await response.json()).archivedAt).toEqual(expect.any(String));
    const archivedLeisure = (await groupsIn(await treeOf(ana, ana.spaceId, "?archived=true"))).find(
      (g) => g.id === leisure.id,
    )!;
    expect(archivedLeisure.categories.every((c) => c.archivedAt !== null)).toBe(true);
    const travel = archivedLeisure.categories.find((c) => c.name === "Viajes")!;
    const restore = await onCategory(restoreCategory, "POST", ana, travel.id, "/restore");
    expect([restore.status, (await restore.json()).code]).toEqual([409, "CategoryGroupArchived"]);
  });
});
