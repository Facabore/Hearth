import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GET as listCategories,
  POST as createCategory,
} from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, registerUser, startTestApp, type TestUser } from "../support/app";
import { inSpace } from "../support/ledger";
import { actingIn, newSharedSpace } from "../support/spaces";

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

describe("category icon and color (HU-E3-05)", () => {
  it("starts seeded and new categories with a default icon and color, copied from the group at creation", async () => {
    const ana = await household();
    const food = await groupNamed(ana, "Food");
    expect(food.key).toBe("food");
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
});
