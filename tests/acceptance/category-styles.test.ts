import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GET as listCategories,
  POST as createCategory,
} from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { PATCH as updateCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/route";
import { POST as createGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/route";
import { PATCH as updateGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/[groupId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { inSpace } from "../support/ledger";
import { actingIn, joinAs, newSharedSpace } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

type Icon = { kind: "SYMBOL"; name: string } | { kind: "EMOJI"; value: string };
interface Styled {
  id: string;
  name: string;
  icon: Icon;
  color: string;
}
interface CategoryDto extends Styled {
  groupId: string;
  parentCategoryId: string | null;
  key: string | null;
}
type Tree = (Styled & {
  key: string | null;
  categories: (CategoryDto & { subcategories: CategoryDto[] })[];
})[];

const symbol = (name: string): Icon => ({ kind: "SYMBOL", name });
const emoji = (value: string): Icon => ({ kind: "EMOJI", value });
const styleOf = ({ icon, color }: Styled) => ({ icon, color });

/** HU-E3-05 Background: "Ana", with locale "en", creates the shared space "Household", seeded in English. */
const household = async (): Promise<TestUser> => {
  const ana = await registerUser("Ana");
  await app.pool.query(`UPDATE "user" SET locale = 'en' WHERE id = $1`, [ana.userId]);
  return actingIn(ana, await newSharedSpace(ana));
};
const treeOf = async (user: TestUser): Promise<Tree> => {
  const response = await call(listCategories, "GET", inSpace(user, "categories"), {
    user,
    params: { spaceId: user.spaceId },
  });
  return ((await response.json()) as { items: Tree }).items;
};
const groupNamed = async (user: TestUser, name: string) => (await treeOf(user)).find((g) => g.name === name)!;
/** A category or a subcategory of the tree, by name. */
const named = async (user: TestUser, name: string): Promise<CategoryDto> =>
  (await treeOf(user))
    .flatMap((g) => g.categories.flatMap((c) => [c, ...c.subcategories]))
    .find((c) => c.name === name)!;
const createIn = (user: TestUser, body: unknown) =>
  call(createCategory, "POST", inSpace(user, "categories"), {
    user,
    params: { spaceId: user.spaceId },
    body,
  });
const created = async (user: TestUser, body: unknown): Promise<CategoryDto> => {
  const response = await createIn(user, body);
  if (response.status !== 201) throw new Error(`category creation failed with status ${response.status}`);
  return (await response.json()) as CategoryDto;
};
const patch = (user: TestUser, categoryId: string, body: unknown) =>
  call(updateCategory, "PATCH", inSpace(user, `categories/${categoryId}`), {
    user,
    params: { spaceId: user.spaceId, categoryId },
    body,
  });
const createGroupIn = (user: TestUser, body: unknown) =>
  call(createGroup, "POST", inSpace(user, "category-groups"), {
    user,
    params: { spaceId: user.spaceId },
    body,
  });
const patchGroup = (user: TestUser, groupId: string, body: unknown) =>
  call(updateGroup, "PATCH", inSpace(user, `category-groups/${groupId}`), {
    user,
    params: { spaceId: user.spaceId, groupId },
    body,
  });

/** What PostgreSQL stores for every group of the space, to show that a refused request wrote nothing. */
const storedGroups = async (user: TestUser): Promise<unknown[]> =>
  (
    await app.pool.query(
      `SELECT id, name, key, icon_kind, icon_value, color, archived_at FROM category_groups WHERE space_id = $1 ORDER BY id`,
      [user.spaceId],
    )
  ).rows;
/** The same for every category and subcategory of the space. */
const storedCategories = async (user: TestUser): Promise<unknown[]> =>
  (
    await app.pool.query(
      `SELECT id, group_id, parent_category_id, name, key, icon_kind, icon_value, color FROM categories WHERE space_id = $1 ORDER BY id`,
      [user.spaceId],
    )
  ).rows;

/** The style bodies a category or a group refuses, with the problem each answers (the domain or the schema judges). */
const styleRefusals = [
  [{ icon: symbol("unicorn") }, [422, "InvalidCategoryIcon"]],
  [{ icon: emoji("🛒🍞") }, [422, "InvalidCategoryIcon"]],
  [{ icon: emoji("a") }, [422, "InvalidCategoryIcon"]],
  [{ color: "#C0FFEE" }, [422, "ValidationFailed"]],
  // The palette keys are upper case and closed: a lower case spelling and an unknown key are both refused.
  [{ color: "sand" }, [422, "ValidationFailed"]],
  [{ color: "NEON" }, [422, "ValidationFailed"]],
  [{ icon: { kind: "IMAGE", url: "https://example.com/cart.png" } }, [422, "ValidationFailed"]],
] as const;

describe("category icon and color (HU-E3-05)", () => {
  it("starts seeded and new categories with a default icon and color, copied from the group at creation", async () => {
    const ana = await household();
    const food = await groupNamed(ana, "Food");
    expect(food.color).toBe("SAND");
    expect(styleOf(food.categories.find((c) => c.key === "groceries")!)).toEqual({
      icon: symbol("cart"),
      color: "SAND",
    });
    for (const group of await treeOf(ana)) {
      expect(group.categories.every((c) => c.color === group.color)).toBe(true);
    }
    const bakery = await created(ana, { groupId: food.id, name: "Bakery" });
    expect(styleOf(bakery)).toEqual(styleOf(food));
  });

  it("creates a category with its own icon and color, and takes the group's for a part left out", async () => {
    const ana = await household();
    const food = await groupNamed(ana, "Food");
    const bakery = await created(ana, {
      groupId: food.id,
      name: "Bakery",
      icon: symbol("bread"),
      color: "ROSE",
    });
    expect(styleOf(bakery)).toEqual({ icon: symbol("bread"), color: "ROSE" });
    const cafe = await created(ana, { groupId: food.id, name: "Cafe", icon: emoji("☕") });
    expect(styleOf(cafe)).toEqual({ icon: emoji("☕"), color: "SAND" });
    const deli = await created(ana, { groupId: food.id, name: "Deli", color: "OLIVE" });
    expect(styleOf(deli)).toEqual({ icon: symbol("apple"), color: "OLIVE" });
    expect(styleOf(await named(ana, "Bakery"))).toEqual({ icon: symbol("bread"), color: "ROSE" });
    expect(styleOf(await groupNamed(ana, "Food"))).toEqual({ icon: symbol("apple"), color: "SAND" });
  });

  it("changes the icon and color of a category, never its group's, and only for managers", async () => {
    const ana = await household();
    const sofi = await registerUser("Sofi");
    await joinAs(ana, ana.spaceId, sofi, "VIEWER");
    const groceries = await named(ana, "Groceries");
    const changed = await patch(ana, groceries.id, { icon: symbol("bread"), color: "ROSE" });
    expect(styleOf((await changed.json()) as Styled)).toEqual({ icon: symbol("bread"), color: "ROSE" });
    // A symbol from the last section and a key added to the palette travel the same way.
    const library = await patch(ana, groceries.id, { icon: symbol("umbrella"), color: "TEAL" });
    expect(styleOf((await library.json()) as Styled)).toEqual({ icon: symbol("umbrella"), color: "TEAL" });
    expect(styleOf(await groupNamed(ana, "Food"))).toEqual({ icon: symbol("apple"), color: "SAND" });
    expect(
      await problemOf(await patch(actingIn(sofi, ana.spaceId), groceries.id, { color: "PINE" })),
    ).toEqual([403, "InsufficientRole"]);
  });

  it("takes one emoji as the icon, and a symbol replaces it again", async () => {
    const ana = await household();
    const groceries = await named(ana, "Groceries");
    const withEmoji = (await (await patch(ana, groceries.id, { icon: emoji("🛒") })).json()) as Styled;
    expect(styleOf(withEmoji)).toEqual({ icon: emoji("🛒"), color: "SAND" });
    const withSymbol = (await (await patch(ana, groceries.id, { icon: symbol("cart") })).json()) as Styled;
    expect(styleOf(withSymbol)).toEqual({ icon: symbol("cart"), color: "SAND" });
  });

  it("refuses unknown symbols, anything but one emoji, and colors outside the palette, and changes nothing", async () => {
    const ana = await household();
    const groceries = await named(ana, "Groceries");
    const stored = await storedCategories(ana);
    for (const [body, problem] of styleRefusals) {
      // A rename travelling with the refused style is refused with it: nothing is half applied.
      expect(await problemOf(await patch(ana, groceries.id, body))).toEqual(problem);
      expect(await problemOf(await patch(ana, groceries.id, { name: "Pantry", ...body }))).toEqual(problem);
      expect(
        await problemOf(await createIn(ana, { groupId: groceries.groupId, name: "Bakery", ...body })),
      ).toEqual(problem);
    }
    expect(styleOf(await named(ana, "Groceries"))).toEqual({ icon: symbol("cart"), color: "SAND" });
    expect(await storedCategories(ana)).toEqual(stored);
  });

  it("shows subcategories with their parent's icon and color, and refuses one of their own", async () => {
    const ana = await household();
    const groceries = await named(ana, "Groceries");
    const vegetables = await created(ana, { parentCategoryId: groceries.id, name: "Vegetables" });
    expect(styleOf(vegetables)).toEqual({ icon: symbol("cart"), color: "SAND" });
    await created(ana, { parentCategoryId: groceries.id, name: "Meat" });
    await patch(ana, groceries.id, { icon: emoji("🛒"), color: "PLUM" });
    const node = (await groupNamed(ana, "Food")).categories.find((c) => c.id === groceries.id)!;
    expect(node.subcategories.map((s) => [s.name, styleOf(s)])).toEqual([
      ["Meat", { icon: emoji("🛒"), color: "PLUM" }],
      ["Vegetables", { icon: emoji("🛒"), color: "PLUM" }],
    ]);
    // A rename of a subcategory answers its parent's shown style, as the tree and the creation do.
    const renamed = await patch(ana, vegetables.id, { name: "Greens" });
    expect(await renamed.json()).toMatchObject({
      name: "Greens",
      parentCategoryId: groceries.id,
      icon: emoji("🛒"),
      color: "PLUM",
    });
    const stored = await storedCategories(ana);
    expect(await problemOf(await patch(ana, vegetables.id, { color: "ROSE" }))).toEqual([
      422,
      "ValidationFailed",
    ]);
    expect(await problemOf(await patch(ana, vegetables.id, { icon: symbol("bread") }))).toEqual([
      422,
      "ValidationFailed",
    ]);
    const fruit = await createIn(ana, { parentCategoryId: groceries.id, name: "Fruit", color: "ROSE" });
    expect(await problemOf(fruit)).toEqual([422, "ValidationFailed"]);
    expect((await named(ana, "Greens")).color).toBe("PLUM");
    expect(await storedCategories(ana)).toEqual(stored);
  });

  it("names the style part a subcategory refuses in errors[].path (issue 121)", async () => {
    const ana = await household();
    const groceries = await named(ana, "Groceries");
    const vegetables = await created(ana, { parentCategoryId: groceries.id, name: "Vegetables" });
    const restaurants = await named(ana, "Restaurants");
    const pathsOf = async (response: Response) => {
      expect(await problemOf(response.clone())).toEqual([422, "ValidationFailed"]);
      return ((await response.json()) as { errors?: { path: string; message: string }[] }).errors?.map(
        (e) => e.path,
      );
    };
    expect(await pathsOf(await patch(ana, vegetables.id, { color: "ROSE" }))).toEqual(["color"]);
    expect(await pathsOf(await patch(ana, vegetables.id, { icon: symbol("bread") }))).toEqual(["icon"]);
    expect(await pathsOf(await patch(ana, vegetables.id, { icon: symbol("bread"), color: "ROSE" }))).toEqual([
      "icon",
      "color",
    ]);
    const fruit = await createIn(ana, {
      parentCategoryId: groceries.id,
      name: "Fruit",
      icon: symbol("apple"),
    });
    expect(await pathsOf(fruit)).toEqual(["icon"]);
    // A style sent with a move that makes a subcategory is named the same way.
    const moved = await patch(ana, restaurants.id, { parentCategoryId: groceries.id, color: "ROSE" });
    expect(await pathsOf(moved)).toEqual(["color"]);
  });

  it("keeps a copy of the parent's style when a subcategory becomes a category", async () => {
    const ana = await household();
    const food = await groupNamed(ana, "Food");
    const groceries = await named(ana, "Groceries");
    await patch(ana, groceries.id, { icon: emoji("🛒"), color: "PLUM" });
    const vegetables = await created(ana, { parentCategoryId: groceries.id, name: "Vegetables" });
    const promoted = await patch(ana, vegetables.id, { parentCategoryId: null, groupId: food.id });
    expect(await promoted.json()).toMatchObject({
      parentCategoryId: null,
      groupId: food.id,
      icon: emoji("🛒"),
      color: "PLUM",
    });
    await patch(ana, groceries.id, { color: "SAGE" });
    expect((await named(ana, "Vegetables")).color).toBe("PLUM");
  });

  it("judges a style sent together with a move on the result: allowed for a category, refused for a subcategory", async () => {
    const ana = await household();
    const food = await groupNamed(ana, "Food");
    const groceries = await named(ana, "Groceries");
    const fruit = await created(ana, { parentCategoryId: groceries.id, name: "Fruit" });
    const own = { icon: symbol("apple"), color: "TEAL" } as const;
    // The result is a category of Food: it carries the style sent with the move (ruling P58).
    const promoted = await patch(ana, fruit.id, { parentCategoryId: null, groupId: food.id, ...own });
    expect(promoted.status).toBe(200);
    expect(await promoted.json()).toMatchObject({ parentCategoryId: null, groupId: food.id, ...own });
    expect(styleOf(await named(ana, "Fruit"))).toEqual(own);
    expect(styleOf(await named(ana, "Groceries"))).toEqual({ icon: symbol("cart"), color: "SAND" });
    // The result is a subcategory: the style is refused and nothing moves.
    const restaurants = await named(ana, "Restaurants");
    const stored = await storedCategories(ana);
    for (const style of [{ color: "ROSE" }, { icon: symbol("bread") }]) {
      const refused = await patch(ana, restaurants.id, { parentCategoryId: groceries.id, ...style });
      expect(await problemOf(refused)).toEqual([422, "ValidationFailed"]);
    }
    expect(await storedCategories(ana)).toEqual(stored);
    // The same move without a style goes through, and the moved category shows its new parent's style.
    const moved = await patch(ana, restaurants.id, { parentCategoryId: groceries.id });
    expect(await moved.json()).toMatchObject({
      parentCategoryId: groceries.id,
      icon: symbol("cart"),
      color: "SAND",
    });
  });

  it("creates and restyles groups; a group created without a style takes tag and GRAPHITE", async () => {
    const ana = await household();
    const pets = (await (await createGroupIn(ana, { name: "Pets" })).json()) as Styled & {
      key: string | null;
    };
    expect(styleOf(pets)).toEqual({ icon: symbol("tag"), color: "GRAPHITE" });
    expect(pets.key).toBeNull();
    const restyled = await patchGroup(ana, pets.id, { icon: emoji("🐶"), color: "MUSTARD" });
    expect(await restyled.json()).toMatchObject({
      name: "Pets",
      icon: emoji("🐶"),
      color: "MUSTARD",
      key: null,
    });
    const kids = await createGroupIn(ana, { name: "Kids", icon: symbol("heart"), color: "ROSE" });
    expect(kids.status).toBe(201);
    expect(styleOf((await kids.json()) as Styled)).toEqual({ icon: symbol("heart"), color: "ROSE" });
  });

  it("restyles a group only for managers", async () => {
    const ana = await household();
    const [sofi, leo, eva] = [
      await registerUser("Sofi"),
      await registerUser("Leo"),
      await registerUser("Eva"),
    ];
    await joinAs(ana, ana.spaceId, sofi, "VIEWER");
    await joinAs(ana, ana.spaceId, leo, "MEMBER");
    await joinAs(ana, ana.spaceId, eva, "ADMIN");
    const food = await groupNamed(ana, "Food");
    const stored = await storedGroups(ana);
    for (const refused of [sofi, leo]) {
      const response = await patchGroup(actingIn(refused, ana.spaceId), food.id, {
        icon: emoji("🥐"),
        color: "PINE",
      });
      expect(await problemOf(response)).toEqual([403, "InsufficientRole"]);
    }
    expect(await storedGroups(ana)).toEqual(stored);
    // An ADMIN manages the tree, so the same request goes through.
    const allowed = await patchGroup(actingIn(eva, ana.spaceId), food.id, {
      icon: emoji("🥐"),
      color: "PINE",
    });
    expect(allowed.status).toBe(200);
    expect(styleOf(await groupNamed(ana, "Food"))).toEqual({ icon: emoji("🥐"), color: "PINE" });
  });

  it("refuses unknown symbols, anything but one emoji, and colors outside the palette in a group body, and changes nothing", async () => {
    const ana = await household();
    const food = await groupNamed(ana, "Food");
    const stored = await storedGroups(ana);
    for (const [body, problem] of styleRefusals) {
      expect(await problemOf(await createGroupIn(ana, { name: "Pets", ...body }))).toEqual(problem);
      // A rename travelling with the refused style is refused with it: nothing is half applied.
      expect(await problemOf(await patchGroup(ana, food.id, { name: "Eating", ...body }))).toEqual(problem);
    }
    expect(await storedGroups(ana)).toEqual(stored);
    expect(styleOf(await groupNamed(ana, "Food"))).toEqual({ icon: symbol("apple"), color: "SAND" });
  });

  it("has no way to clear a style: a null icon or color is refused, never read as a reset to the group's", async () => {
    const ana = await household();
    const food = await groupNamed(ana, "Food");
    const groceries = await named(ana, "Groceries");
    // Styles unlike the group's, so a reset to the group's would show.
    await patch(ana, groceries.id, { icon: emoji("🛒"), color: "PLUM" });
    await patchGroup(ana, food.id, { icon: emoji("🍽"), color: "OLIVE" });
    const stored = [await storedCategories(ana), await storedGroups(ana)];
    for (const body of [{ icon: null }, { color: null }, { icon: null, color: null }]) {
      expect(await problemOf(await patch(ana, groceries.id, body))).toEqual([422, "ValidationFailed"]);
      expect(await problemOf(await patchGroup(ana, food.id, body))).toEqual([422, "ValidationFailed"]);
    }
    expect([await storedCategories(ana), await storedGroups(ana)]).toEqual(stored);
    expect(styleOf(await named(ana, "Groceries"))).toEqual({ icon: emoji("🛒"), color: "PLUM" });
    expect(styleOf(await groupNamed(ana, "Food"))).toEqual({ icon: emoji("🍽"), color: "OLIVE" });
  });

  it("returns a seeded group's catalog key, none for a group users create, and takes no key from any body", async () => {
    const ana = await household();
    expect(Object.fromEntries((await treeOf(ana)).map((g) => [g.name, g.key]))).toEqual({
      Food: "food",
      Health: "health",
      Housing: "housing",
      Income: "income",
      Leisure: "leisure",
      Transport: "transport",
    });
    // The schemas strip a `key` rather than refuse it (P79): the request succeeds and the key is not stored.
    const pets = await createGroupIn(ana, { name: "Pets", key: "food" });
    expect(pets.status).toBe(201);
    const petsDto = (await pets.json()) as Styled & { key: string | null };
    expect(petsDto.key).toBeNull();
    const food = await groupNamed(ana, "Food");
    const renamed = await patchGroup(ana, food.id, { name: "Eating", color: "EMBER", key: "housing" });
    expect(await renamed.json()).toMatchObject({ name: "Eating", color: "EMBER", key: "food" });
    expect((await groupNamed(ana, "Eating")).key).toBe("food");
    // A user group cannot be keyed by a rename either.
    const keyed = await patchGroup(ana, petsDto.id, { name: "Animals", key: "leisure" });
    expect(await keyed.json()).toMatchObject({ name: "Animals", key: null });
    const keys = await app.pool.query(
      `SELECT name, key FROM category_groups WHERE space_id = $1 ORDER BY name`,
      [ana.spaceId],
    );
    expect(
      Object.fromEntries(keys.rows.map((r: { name: string; key: string | null }) => [r.name, r.key])),
    ).toEqual({
      Animals: null,
      Eating: "food",
      Health: "health",
      Housing: "housing",
      Income: "income",
      Leisure: "leisure",
      Transport: "transport",
    });
    // A category body takes no key either.
    const bakery = await createIn(ana, { groupId: food.id, name: "Bakery", key: "groceries" });
    expect(bakery.status).toBe(201);
    expect(await bakery.json()).toMatchObject({ name: "Bakery", key: null });
  });
});
