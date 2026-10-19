import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setContainerForTests, type Container } from "@/composition/container";
import { GET as spendingByGroupRoute } from "@/app/api/v1/spaces/[spaceId]/reports/spending-by-group/route";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import {
  categoryWithKey,
  cop,
  household,
  newAccount,
  joinHousehold,
  type Household,
} from "../support/ledger";
import { archiveHousehold } from "../support/recurrences";
import { getSpendingByGroup, spend, type SpendingByGroupDto } from "../support/reporting";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** HU-E7-01 Background's categories of Household, by catalog key; Household's groups are seeded (HU-E3-05). */
const categoriesOf = async (h: Household) => ({
  rent: await categoryWithKey(h.ana, "rent"),
  groceries: h.groceries,
  utilities: await categoryWithKey(h.ana, "utilities"),
  entertainment: await categoryWithKey(h.ana, "entertainment"),
  restaurants: await categoryWithKey(h.ana, "restaurants"),
});
type Categories = Awaited<ReturnType<typeof categoriesOf>>;

/** HU-E7-01 Background: November 2026 in Household; `groceries` splits Groceries' 900,000 COP when given. */
const novemberExpenses = async (
  h: Household,
  c: Categories,
  groceries: [string, number][] = [[c.groceries, 900_000]],
) => {
  await spend(h.ana, c.rent, 1_200_000, "2026-11-01");
  for (const [categoryId, pesos] of groceries) await spend(h.ana, categoryId, pesos, "2026-11-05");
  await spend(h.juan, c.utilities, 400_000, "2026-11-10");
  await spend(h.juan, c.entertainment, 250_000, "2026-11-15");
  await spend(h.ana, c.restaurants, 60_000, "2026-11-30");
};

const breakdownOf = async (user: TestUser, spaceId: string, period: string): Promise<SpendingByGroupDto> => {
  const response = await getSpendingByGroup(user, spaceId, { period });
  expect(response.status).toBe(200);
  return (await response.json()) as SpendingByGroupDto;
};

describe("spending by group of a space over HTTP (HU-E7-06)", () => {
  it("totals Household's November by group, the largest first, the same for VIEWER Sofi (@critical)", async () => {
    const h = await household();
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    await novemberExpenses(h, await categoriesOf(h));
    // The period ends with its last day: the next period's first day (1 December) is not counted in November.
    await spend(h.ana, h.groceries, 70_000, "2026-12-01");
    const breakdown = await breakdownOf(h.ana, h.spaceId, "2026-11");
    expect(breakdown.total).toEqual(cop(2_810_000));
    expect(breakdown.period).toEqual({ label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" });
    // Transport has no spending, so it is not listed.
    expect(breakdown.groups.map((g) => [g.key, g.total, g.share])).toEqual([
      ["housing", cop(1_600_000), "56.94"],
      ["food", cop(960_000), "34.16"],
      ["leisure", cop(250_000), "8.90"],
    ]);
    // Every group and category of a space's own breakdown has an id, a name, is live and names no space.
    for (const group of breakdown.groups) {
      for (const node of [group, ...group.categories]) {
        expect(node.id).not.toBeNull();
        expect(node.name).toEqual(expect.any(String));
        expect(node.name).not.toBe("");
        expect(node.archived).toBe(false);
        expect(node).not.toHaveProperty("space");
      }
    }
    expect(await breakdownOf(sofi, h.spaceId, "2026-11")).toEqual(breakdown);
  });

  it("answers 401 without a session and still reads an archived space", async () => {
    const h = await household();
    // Paid from the shared fund, so every member stays settled and the space can be archived (HU-E1-09).
    const fund = await newAccount(h.ana, "Household Fund", 5_000_000, "SHARED_FUND");
    await spend(h.ana, await categoryWithKey(h.ana, "rent"), 1_200_000, "2026-11-01", fund);
    await spend(h.ana, h.groceries, 900_000, "2026-11-05", fund);
    const anonymous = await call(
      spendingByGroupRoute,
      "GET",
      `/api/v1/spaces/${h.spaceId}/reports/spending-by-group?period=2026-11`,
      { params: { spaceId: h.spaceId } },
    );
    expect(await problemOf(anonymous)).toEqual([401, "Unauthenticated"]);
    await archiveHousehold(h);
    expect((await breakdownOf(h.ana, h.spaceId, "2026-11")).total).toEqual(cop(2_100_000));
  });

  it("answers a stranger and an unknown space 404 before looking at the period", async () => {
    const h = await household();
    const marta = await registerUser("Marta");
    expect(await problemOf(await getSpendingByGroup(marta, h.spaceId, { period: "not a label" }))).toEqual([
      404,
      "SpaceNotFound",
    ]);
    expect(
      await problemOf(
        await getSpendingByGroup(h.ana, "00000000-0000-4000-8000-000000000000", { period: "2026-11" }),
      ),
    ).toEqual([404, "SpaceNotFound"]);
  });

  it("hides the space from non-members and malformed ids, refuses bad periods and answers 0 for an empty one", async () => {
    const h = await household();
    const marta = await registerUser("Marta");
    expect(await problemOf(await getSpendingByGroup(marta, h.spaceId, { period: "2026-11" }))).toEqual([
      404,
      "SpaceNotFound",
    ]);
    expect(await problemOf(await getSpendingByGroup(h.ana, "not-a-uuid", { period: "2026-11" }))).toEqual([
      404,
      "SpaceNotFound",
    ]);
    expect(await problemOf(await getSpendingByGroup(h.ana, h.spaceId, {}))).toEqual([
      422,
      "ValidationFailed",
    ]);
    expect(await problemOf(await getSpendingByGroup(h.ana, h.spaceId, { period: "2026-11 H1" }))).toEqual([
      422,
      "InvalidPeriodLabel",
    ]);
    expect(await breakdownOf(h.ana, h.spaceId, "2027-01")).toMatchObject({ total: cop(0), groups: [] });
  });
});
