import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as archiveCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/archive/route";
import { DELETE as deleteCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/route";
import {
  GET as listCategories,
  POST as createCategory,
} from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { DELETE as deleteTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { POST as recordTransfer } from "@/app/api/v1/spaces/[spaceId]/transfers/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import {
  newPlan,
  lineNamed,
  patchLine,
  planOf,
  putCategories,
  referencePlan,
  setCapacities,
  addLine,
  type PlanDto,
} from "../support/budgeting";
import { categoryWithKey, cop, joinHousehold, post, type HouseholdMember } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** `payer` pays `pesos` on `date` from their own account in `categoryId`; returns the expense id. */
const spends = async (payer: HouseholdMember, categoryId: string, pesos: number, date: string) => {
  const response = await post(recordExpense, payer, "expenses", {
    description: "Market",
    date,
    categoryId,
    amount: cop(pesos),
    accountId: payer.account,
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
};

/** `user` adds a category named `name` to the first group of the space's tree; returns its id. */
const newCategory = async (user: TestUser, name: string) => {
  const params = { spaceId: user.spaceId };
  const tree = await call(listCategories, "GET", `/api/v1/spaces/${user.spaceId}/categories`, {
    user,
    params,
  });
  const { items } = (await tree.json()) as { items: { id: string }[] };
  const created = await call(createCategory, "POST", `/api/v1/spaces/${user.spaceId}/categories`, {
    user,
    params,
    body: { groupId: items[0]!.id, name },
  });
  expect(created.status).toBe(201);
  return ((await created.json()) as { id: string }).id;
};

/** The reference plan with Groceries and Utilities mapped to Home (HU-E6-04 Background and first scenario). */
const mapped = async () => {
  const ref = await referencePlan();
  const { h, planId, lineId } = ref;
  const key = (catalogKey: string) => categoryWithKey(h.ana, catalogKey);
  const categories = {
    groceries: await key("groceries"),
    utilities: await key("utilities"),
    entertainment: await key("entertainment"),
    restaurants: await key("restaurants"),
  };
  const response = await putCategories(h.ana, h.spaceId, planId, lineId("Home"), [
    categories.groceries,
    categories.utilities,
  ]);
  expect(response.status).toBe(200);
  return { ...ref, categories, plan: (await response.json()) as PlanDto };
};

describe("category to line mapping (HU-E6-04)", () => {
  it("maps Groceries and Utilities to Home, so a Groceries expense on 2026-11-10 counts as spent in Home", async () => {
    const { h, planId, categories, plan } = await mapped();
    expect([...lineNamed(plan, "Home").categoryIds].sort()).toEqual(
      [categories.groceries, categories.utilities].sort(),
    );
    await spends(h.ana, categories.groceries, 85_000, "2026-11-10");
    const home = lineNamed(await planOf(h.juan, h.spaceId, planId), "Home");
    expect([home.spent, home.available]).toEqual([cop(85_000), cop(1_385_000)]);
  });

  it("maps a category to at most one line per plan", async () => {
    const { h, planId, lineId, categories } = await mapped();
    const free = await putCategories(h.ana, h.spaceId, planId, lineId("Free"), [categories.groceries]);
    expect(await problemOf(free)).toEqual([409, "CategoryAlreadyMapped"]);
  });

  // Preflight N8: the story's "Outings" is the seeded `entertainment` category; the catalog has no `outings` key.
  it("lets the catch-all line Free consume a 50,000 COP outing (entertainment) recorded on 2026-11-12 (golden)", async () => {
    const { h, planId, lineId, categories } = await mapped();
    expect((await patchLine(h.ana, h.spaceId, planId, lineId("Free"), { isCatchAll: true })).status).toBe(
      200,
    );
    await spends(h.ana, categories.entertainment, 50_000, "2026-11-12");
    const plan = await planOf(h.ana, h.spaceId, planId);
    expect([lineNamed(plan, "Free").spent, plan.unbudgeted]).toEqual([cop(50_000), null]);
  });

  it("puts a 60,000 COP restaurant expense in Unbudgeted when the plan has no catch-all line", async () => {
    const { h, planId, categories } = await mapped();
    await spends(h.ana, categories.restaurants, 60_000, "2026-11-12");
    expect((await planOf(h.ana, h.spaceId, planId)).unbudgeted).toEqual({
      spent: cop(60_000),
      available: cop(-60_000),
    });
  });

  it("counts live expenses dated within the plan's period, and the transfers into the savings account", async () => {
    const { h, planId, categories, savings } = await mapped();
    await spends(h.ana, categories.groceries, 10_000, "2026-10-31");
    await spends(h.ana, categories.groceries, 20_000, "2026-12-01");
    const deleted = await spends(h.ana, categories.groceries, 30_000, "2026-11-15");
    const removal = await call(
      deleteTransaction,
      "DELETE",
      `/api/v1/spaces/${h.spaceId}/transactions/${deleted}`,
      {
        user: h.ana,
        params: { spaceId: h.spaceId, transactionId: deleted },
      },
    );
    expect(removal.status).toBe(204);
    const transfer = await post(recordTransfer, h.ana.personal, "transfers", {
      description: "Ahorro",
      date: "2026-11-05",
      amount: cop(200_000),
      sourceAccountId: h.ana.account,
      destinationAccountId: savings,
    });
    expect(transfer.status).toBe(201);
    const plan = await planOf(h.ana, h.spaceId, planId);
    const saved = lineNamed(plan, "Savings");
    expect([lineNamed(plan, "Home").spent, saved.spent, saved.available]).toEqual([
      cop(0),
      cop(200_000),
      cop(400_000),
    ]);
  });

  it("maps only live categories of the plan's space, never newly an archived one, and none to a SAVINGS line", async () => {
    const { h, planId, lineId, categories } = await mapped();
    const personal = await categoryWithKey(h.ana.personal, "groceries");
    const foreign = await putCategories(h.ana, h.spaceId, planId, lineId("Free"), [personal]);
    expect(await problemOf(foreign)).toEqual([422, "CategoryNotInSpace"]);
    const archived = await call(
      archiveCategory,
      "POST",
      `/api/v1/spaces/${h.spaceId}/categories/${categories.restaurants}/archive`,
      { user: h.ana, params: { spaceId: h.spaceId, categoryId: categories.restaurants } },
    );
    expect(archived.status).toBe(200);
    const old = await putCategories(h.ana, h.spaceId, planId, lineId("Free"), [categories.restaurants]);
    expect(await problemOf(old)).toEqual([409, "CategoryArchived"]);
    const savings = await putCategories(h.ana, h.spaceId, planId, lineId("Savings"), [
      categories.entertainment,
    ]);
    expect(await problemOf(savings)).toEqual([409, "SavingsLineNotMappable"]);
  });

  it("answers the identical 422 CategoryNotInSpace for an unknown, a malformed, another space's and a deleted category", async () => {
    const { h, planId, lineId, plan } = await mapped();
    const marta = await registerUser("Marta");
    const bakery = await newCategory(h.ana, "Panadería");
    const removal = await call(deleteCategory, "DELETE", `/api/v1/spaces/${h.spaceId}/categories/${bakery}`, {
      user: h.ana,
      params: { spaceId: h.spaceId, categoryId: bakery },
    });
    expect(removal.status).toBe(204);
    const elsewhere = [
      "0190a000-0000-7000-8000-000000000000",
      "not-a-uuid",
      await categoryWithKey(marta, "groceries"),
      await categoryWithKey(h.ana.personal, "groceries"),
      bakery,
    ];
    const answers: [number, object][] = [];
    for (const categoryId of elsewhere) {
      const response = await putCategories(h.ana, h.spaceId, planId, lineId("Free"), [categoryId]);
      // Everything but the per-request id: nothing in the answer tells the ids apart.
      answers.push([response.status, { ...(await response.json()), requestId: undefined }]);
    }
    const [first, ...rest] = answers;
    expect(first).toMatchObject([422, { code: "CategoryNotInSpace" }]);
    for (const other of rest) expect(other).toEqual(first);
    expect(await planOf(h.ana, h.spaceId, planId)).toEqual(plan);
  });

  it("keeps a category that a plan maps or once mapped from being deleted (HU-E3-03, Review Focus 6)", async () => {
    const { h, planId, lineId, categories } = await mapped();
    const unmap = await putCategories(h.ana, h.spaceId, planId, lineId("Home"), [categories.groceries]);
    expect(lineNamed((await unmap.json()) as PlanDto, "Home").categoryIds).toEqual([categories.groceries]);
    const removal = await call(
      deleteCategory,
      "DELETE",
      `/api/v1/spaces/${h.spaceId}/categories/${categories.utilities}`,
      { user: h.ana, params: { spaceId: h.spaceId, categoryId: categories.utilities } },
    );
    expect(await problemOf(removal)).toEqual([409, "CategoryInUse"]);
    const { rows } = await app.pool.query(
      "SELECT unmapped_at FROM budget_line_categories WHERE category_id = $1",
      [categories.utilities],
    );
    expect(rows.map((r: { unmapped_at: Date | null }) => r.unmapped_at !== null)).toEqual([true]);
  });

  it("refuses MEMBER Juan, a VIEWER and a stale If-Match, and answers the plan with its new ETag", async () => {
    const { h, planId, lineId, categories } = await mapped();
    const vera = await joinHousehold(h, "Vera", "VIEWER");
    const plan = await planOf(h.ana, h.spaceId, planId);
    const home = lineId("Home");
    expect(await problemOf(await putCategories(h.juan, h.spaceId, planId, home, []))).toEqual([
      403,
      "InsufficientRole",
    ]);
    expect(await problemOf(await putCategories(vera, h.spaceId, planId, home, []))).toEqual([
      403,
      "InsufficientRole",
    ]);
    const stale = await putCategories(h.ana, h.spaceId, planId, home, [], plan.version - 1);
    expect(await problemOf(stale)).toEqual([412, "PreconditionFailed"]);
    expect(await planOf(h.ana, h.spaceId, planId)).toEqual(plan);
    const replaced = await putCategories(
      h.ana,
      h.spaceId,
      planId,
      home,
      [categories.groceries],
      plan.version,
    );
    expect([replaced.status, replaced.headers.get("etag")]).toEqual([200, `"${plan.version + 1}"`]);
    expect(await planOf(h.ana, h.spaceId, planId)).toEqual(await replaced.json());
  });

  it("lets an ADMIN map, and answers 404 to a stranger, a foreign plan and a foreign or malformed line", async () => {
    const { h, planId, lineId, categories } = await mapped();
    const luis = await joinHousehold(h, "Luis", "ADMIN");
    const marta = await registerUser("Marta");
    const home = lineId("Home");
    expect(await problemOf(await putCategories(marta, h.spaceId, planId, home, []))).toEqual([
      404,
      "SpaceNotFound",
    ]);
    const foreign = await newPlan(marta, marta.spaceId, "2026-11");
    for (const planOfElsewhere of [foreign.id, "not-a-uuid"]) {
      const response = await putCategories(h.ana, h.spaceId, planOfElsewhere, home, []);
      expect(await problemOf(response)).toEqual([404, "BudgetPlanNotFound"]);
    }

    const { id: december } = await newPlan(h.ana, h.spaceId, "2026-12");
    await setCapacities(h.ana, h.spaceId, december, [[h.ana.memberId, 1_600_000]]);
    const later = lineNamed(
      await addLine(h.ana, h.spaceId, december, { name: "Food", pesos: 500_000 }),
      "Food",
    );
    const other = await referencePlan();
    for (const lineOfElsewhere of [
      later.id,
      other.lineId("Home"),
      "0190a000-0000-7000-8000-000000000000",
      "not-a-uuid",
    ]) {
      const response = await putCategories(h.ana, h.spaceId, planId, lineOfElsewhere, [categories.groceries]);
      expect(await problemOf(response)).toEqual([404, "BudgetLineNotFound"]);
    }
    expect((await planOf(h.ana, h.spaceId, december)).lines.map((l) => l.categoryIds)).toEqual([[]]);

    const replaced = await putCategories(luis, h.spaceId, planId, home, [categories.groceries]);
    expect(lineNamed((await replaced.json()) as PlanDto, "Home").categoryIds).toEqual([categories.groceries]);
  });

  it("refuses a mapping in an archived space (HU-E1-09), and the mappings stay", async () => {
    const { h, planId, lineId, plan } = await mapped();
    const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${h.spaceId}/archive`, {
      user: h.ana,
      params: { spaceId: h.spaceId },
    });
    expect(archived.status).toBe(204);
    const refused = await putCategories(h.ana, h.spaceId, planId, lineId("Home"), []);
    expect(await problemOf(refused)).toEqual([409, "SpaceArchived"]);
    expect(await planOf(h.ana, h.spaceId, planId)).toEqual(plan);
  });

  it("takes at most 200 non-empty category ids", async () => {
    const { h, planId, lineId, categories } = await mapped();
    const home = lineId("Home");
    const tooMany = Array.from({ length: 201 }, () => categories.groceries);
    expect(await problemOf(await putCategories(h.ana, h.spaceId, planId, home, tooMany))).toEqual([
      422,
      "ValidationFailed",
    ]);
    expect(await problemOf(await putCategories(h.ana, h.spaceId, planId, home, [""]))).toEqual([
      422,
      "ValidationFailed",
    ]);
  });
});
