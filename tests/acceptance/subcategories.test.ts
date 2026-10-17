import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GET as listCategories,
  POST as createCategory,
} from "@/app/api/v1/spaces/[spaceId]/categories/route";
import {
  DELETE as deleteCategory,
  PATCH as updateCategory,
} from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/route";
import { POST as archiveCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/archive/route";
import { POST as restoreCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/restore/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { categoryWithKey, cop, inSpace, newAccount, post } from "../support/ledger";

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
  groupId: string;
  parentCategoryId: string | null;
  name: string;
  key: string | null;
  archivedAt: string | null;
}
type Tree = { id: string; categories: (CategoryDto & { subcategories: CategoryDto[] })[] }[];

const createIn = (user: TestUser, body: unknown) =>
  call(createCategory, "POST", inSpace(user, "categories"), {
    user,
    params: { spaceId: user.spaceId },
    body,
  });
const subcategory = async (user: TestUser, parentCategoryId: string, name: string): Promise<CategoryDto> => {
  const response = await createIn(user, { parentCategoryId, name });
  if (response.status !== 201) throw new Error(`subcategory failed with status ${response.status}`);
  return (await response.json()) as CategoryDto;
};
const treeOf = async (user: TestUser, archived = false): Promise<Tree> =>
  (
    (await (
      await call(listCategories, "GET", inSpace(user, `categories?archived=${archived}`), {
        user,
        params: { spaceId: user.spaceId },
      })
    ).json()) as { items: Tree }
  ).items;
const onCategory = (
  handler: typeof updateCategory,
  method: string,
  user: TestUser,
  id: string,
  body?: unknown,
) =>
  call(handler, method, inSpace(user, `categories/${id}`), {
    user,
    params: { spaceId: user.spaceId, categoryId: id },
    body,
  });

describe("optional subcategories (HU-E3-04)", () => {
  it("creates Verduras and Carnes under Mercado, in its group and without catalog key", async () => {
    const ana = await registerUser("Ana");
    const mercado = await categoryWithKey(ana, "groceries");
    const verduras = await subcategory(ana, mercado, "Verduras");
    await subcategory(ana, mercado, "Carnes");
    const node = (await treeOf(ana)).flatMap((g) => g.categories).find((c) => c.id === mercado)!;
    expect(node.subcategories.map((s) => [s.name, s.parentCategoryId, s.groupId, s.key])).toEqual([
      ["Carnes", mercado, node.groupId, null],
      ["Verduras", mercado, node.groupId, null],
    ]);
    expect(verduras.parentCategoryId).toBe(mercado);
  });

  it("asks for a groupId or a parentCategoryId when creating", async () => {
    const ana = await registerUser("Ana");
    expect(await problemOf(await createIn(ana, { name: "X" }))).toEqual([422, "ValidationFailed"]);
  });

  it("refuses a fourth level and moving Mercado under Restaurantes", async () => {
    const ana = await registerUser("Ana");
    const mercado = await categoryWithKey(ana, "groceries");
    const verduras = await subcategory(ana, mercado, "Verduras");
    expect(await problemOf(await createIn(ana, { parentCategoryId: verduras.id, name: "Orgánico" }))).toEqual(
      [409, "CategoryDepthExceeded"],
    );
    const restaurantes = await categoryWithKey(ana, "restaurants");
    const moved = await onCategory(updateCategory, "PATCH", ana, mercado, { parentCategoryId: restaurantes });
    expect(await problemOf(moved)).toEqual([409, "CategoryDepthExceeded"]);
  });

  it("archives the subcategories with their category and restores one only under a live parent", async () => {
    const ana = await registerUser("Ana");
    const bank = await newAccount(ana, "Bancolombia", 1_000_000);
    const mercado = await categoryWithKey(ana, "groceries");
    const verduras = await subcategory(ana, mercado, "Verduras");
    expect((await onCategory(archiveCategory, "POST", ana, mercado)).status).toBe(200);
    const archivedNode = (await treeOf(ana, true))
      .flatMap((g) => g.categories)
      .find((c) => c.id === mercado)!;
    expect(archivedNode.subcategories[0]?.archivedAt).not.toBeNull();
    const spent = await post(recordExpense, ana, "expenses", {
      categoryId: verduras.id,
      amount: cop(40_000),
      accountId: bank,
    });
    expect(await problemOf(spent)).toEqual([409, "CategoryArchived"]);
    expect(await problemOf(await onCategory(restoreCategory, "POST", ana, verduras.id))).toEqual([
      409,
      "ParentCategoryArchived",
    ]);
  });

  it("keeps a category with subcategories, and promotes a subcategory back to a category", async () => {
    const ana = await registerUser("Ana");
    const group = (await treeOf(ana))[0]!.id;
    const pets = (await (await createIn(ana, { groupId: group, name: "Mascotas" })).json()) as CategoryDto;
    const vet = await subcategory(ana, pets.id, "Veterinario");
    expect(await problemOf(await onCategory(deleteCategory, "DELETE", ana, pets.id))).toEqual([
      409,
      "CategoryInUse",
    ]);
    const promoted = await onCategory(updateCategory, "PATCH", ana, vet.id, { parentCategoryId: null });
    expect(await promoted.json()).toMatchObject({ parentCategoryId: null, groupId: group });
    expect((await onCategory(deleteCategory, "DELETE", ana, pets.id)).status).toBe(204);
  });
});

// A subcategory takes its parent's group, so a body that names both a group and a parent is ambiguous: create and
// update refuse it the same way, before anything is written.
describe("groupId together with a parentCategoryId (HU-E3-04)", () => {
  it("refuses it on create and creates nothing", async () => {
    const ana = await registerUser("Ana");
    const mercado = await categoryWithKey(ana, "groceries");
    const group = (await treeOf(ana))[0]!.id;
    const refused = await createIn(ana, { groupId: group, parentCategoryId: mercado, name: "Verduras" });
    expect(await problemOf(refused)).toEqual([422, "ValidationFailed"]);
    const everyCategory = (await treeOf(ana)).flatMap((g) =>
      g.categories.flatMap((c) => [c, ...c.subcategories]),
    );
    expect(everyCategory.map((c) => c.name)).not.toContain("Verduras");
  });

  it("refuses it on update and changes nothing", async () => {
    const ana = await registerUser("Ana");
    const mercado = await categoryWithKey(ana, "groceries");
    const group = (await treeOf(ana))[0]!.id;
    const pets = (await (await createIn(ana, { groupId: group, name: "Mascotas" })).json()) as CategoryDto;
    const refused = await onCategory(updateCategory, "PATCH", ana, pets.id, {
      groupId: group,
      parentCategoryId: mercado,
    });
    expect(await problemOf(refused)).toEqual([422, "ValidationFailed"]);
    const after = (await treeOf(ana)).flatMap((g) => g.categories).find((c) => c.id === pets.id);
    expect(after).toMatchObject({ groupId: pets.groupId, parentCategoryId: null });
  });

  it("lets a null parentCategoryId through with a groupId: the subcategory becomes a category of that group", async () => {
    const ana = await registerUser("Ana");
    const mercado = await categoryWithKey(ana, "groceries");
    const verduras = await subcategory(ana, mercado, "Verduras");
    const other = (await treeOf(ana)).find((g) => g.id !== verduras.groupId)!.id;
    const promoted = await onCategory(updateCategory, "PATCH", ana, verduras.id, {
      groupId: other,
      parentCategoryId: null,
    });
    expect(promoted.status).toBe(200);
    expect(await promoted.json()).toMatchObject({ id: verduras.id, groupId: other, parentCategoryId: null });
  });
});

describe("the parent of a subcategory (HU-E3-04)", () => {
  it("refuses to create a subcategory under an archived category", async () => {
    const ana = await registerUser("Ana");
    const mercado = await categoryWithKey(ana, "groceries");
    expect((await onCategory(archiveCategory, "POST", ana, mercado)).status).toBe(200);
    const refused = await createIn(ana, { parentCategoryId: mercado, name: "Verduras" });
    expect(await problemOf(refused)).toEqual([409, "ParentCategoryArchived"]);
  });

  it("refuses to move a category under an archived category", async () => {
    const ana = await registerUser("Ana");
    const mercado = await categoryWithKey(ana, "groceries");
    const restaurantes = await categoryWithKey(ana, "restaurants");
    expect((await onCategory(archiveCategory, "POST", ana, mercado)).status).toBe(200);
    const moved = await onCategory(updateCategory, "PATCH", ana, restaurantes, { parentCategoryId: mercado });
    expect(await problemOf(moved)).toEqual([409, "ParentCategoryArchived"]);
  });

  it("answers CategoryNotFound for a parentCategoryId that is not a category of the space", async () => {
    const ana = await registerUser("Ana");
    const restaurantes = await categoryWithKey(ana, "restaurants");
    for (const unknown of ["nope", "0197d6a2-0000-7000-8000-000000000000"]) {
      expect(await problemOf(await createIn(ana, { parentCategoryId: unknown, name: "Verduras" }))).toEqual([
        404,
        "CategoryNotFound",
      ]);
      const moved = await onCategory(updateCategory, "PATCH", ana, restaurantes, {
        parentCategoryId: unknown,
      });
      expect(await problemOf(moved)).toEqual([404, "CategoryNotFound"]);
    }
  });
});
