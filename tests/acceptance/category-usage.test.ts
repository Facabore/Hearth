import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GET as listCategories,
  POST as createCategory,
} from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { DELETE as deleteTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, registerUser, startTestApp, type TestUser } from "../support/app";
import { categoryWithKey, cop, inSpace, newAccount } from "../support/ledger";

interface Node {
  id: string;
  name: string;
  usageCount?: number;
  subcategories: Node[];
}

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const counts = async (user: TestUser, query = "") => {
  const response = await call(listCategories, "GET", inSpace(user, `categories${query}`), {
    user,
    params: { spaceId: user.spaceId },
  });
  const { items } = (await response.json()) as { items: { categories: Node[] }[] };
  const nodes = items.flatMap((g) => g.categories).flatMap((c) => [c, ...c.subcategories]);
  return new Map(nodes.map((n) => [n.name, n.usageCount]));
};
const spend = async (user: TestUser, accountId: string, categoryId: string): Promise<string> => {
  const response = await call(recordExpense, "POST", inSpace(user, "expenses"), {
    user,
    params: { spaceId: user.spaceId },
    body: { amount: cop(40_000), date: "2026-10-05", categoryId, accountId },
  });
  if (response.status !== 201) throw new Error(`expense failed with status ${response.status}`);
  return ((await response.json()) as { id: string }).id;
};

describe("usage count per category (#240, ruling P297)", () => {
  it("counts each category's live movements, a subcategory's toward itself, and 0 where none", async () => {
    const ana = await registerUser("Ana");
    const bank = await newAccount(ana, "Bancolombia", 1_000_000);
    const groceries = await categoryWithKey(ana, "groceries");
    const rent = await categoryWithKey(ana, "rent");
    const vegetables = (await (
      await call(createCategory, "POST", inSpace(ana, "categories"), {
        user: ana,
        params: { spaceId: ana.spaceId },
        body: { parentCategoryId: groceries, name: "Verduras" },
      })
    ).json()) as { id: string };

    await spend(ana, bank, groceries);
    await spend(ana, bank, groceries);
    await spend(ana, bank, vegetables.id);
    await spend(ana, bank, rent);
    // A deleted movement no longer counts (D8: it stays stored, logically deleted).
    const deleted = await spend(ana, bank, rent);
    const removed = await call(deleteTransaction, "DELETE", inSpace(ana, `transactions/${deleted}`), {
      user: ana,
      params: { spaceId: ana.spaceId, transactionId: deleted },
    });
    expect(removed.status).toBe(204);

    const usage = await counts(ana);
    expect(usage.get("Mercado")).toBe(2);
    expect(usage.get("Verduras")).toBe(1);
    expect(usage.get("Arriendo")).toBe(1);
    expect(usage.get("Restaurantes")).toBe(0);
  });

  it("counts only the space's own movements", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    await spend(
      juan,
      await newAccount(juan, "Nequi", 100_000, "WALLET"),
      await categoryWithKey(juan, "groceries"),
    );
    expect((await counts(ana)).get("Mercado")).toBe(0);
    expect((await counts(juan)).get("Mercado")).toBe(1);
  });
});
