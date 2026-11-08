import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as myActivity } from "@/app/api/v1/me/activity/route";
import { GET as unifiedView } from "@/app/api/v1/me/unified-view/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { GET as getSpace } from "@/app/api/v1/spaces/[spaceId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import {
  categoryWithKey,
  cop,
  household,
  joinHousehold,
  paysEqually,
  post,
  settles,
  type MoneyDto,
} from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface ActivityDto {
  space: { id: string; name: string; kind: string; color: string };
  transaction: { id: string; type: string; description: string; amount: MoneyDto };
  recordedBy: { name: string | null; you: boolean };
  you: { memberIds: string[]; share: MoneyDto | null; paid: MoneyDto | null };
  memberNames: Record<string, string>;
  category: { name: string; path: string; icon: unknown; color: string | null } | null;
}

const activityOf = async (user: TestUser, query = "?from=2026-10-01") => {
  const response = await call(myActivity, "GET", `/api/v1/me/activity${query}`, { user });
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: ActivityDto[] }).items;
};

describe("GET /api/v1/me/activity (ruling P306)", () => {
  it("tells Ana what Juan recorded in the household and her part of it, never anyone's personal space", async () => {
    const h = await household();
    // Juan pays 180,000 COP of groceries, split equally with Ana; then he buys something in his own space.
    const groceries = await paysEqually(h.juan, 180_000, [h.ana.memberId, h.juan.memberId], h.groceries);
    const own = await post(recordExpense, h.juan.personal, "expenses", {
      description: "Juan's lunch",
      amount: cop(20_000),
      date: "2026-10-06",
      categoryId: await categoryWithKey(h.juan.personal, "groceries"),
      accountId: h.juan.account,
    });
    expect(own.status).toBe(201);
    const space = (await (
      await call(getSpace, "GET", `/api/v1/spaces/${h.spaceId}`, {
        user: h.ana,
        params: { spaceId: h.spaceId },
      })
    ).json()) as { name: string; color: string };

    const items = await activityOf(h.ana);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      space: { id: h.spaceId, name: space.name, kind: "SHARED", color: space.color },
      transaction: { id: groceries.id, type: "EXPENSE", amount: cop(180_000) },
      recordedBy: { name: "Juan", you: false },
      you: { memberIds: [h.ana.memberId], share: cop(90_000), paid: null },
      memberNames: { [h.ana.memberId]: "Ana", [h.juan.memberId]: "Juan" },
    });
    expect(items[0]!.category).toMatchObject({ path: expect.any(String), color: expect.any(String) });

    // Juan reads the same movement as his: he recorded it and paid it all.
    const [his] = await activityOf(h.juan);
    expect(his).toMatchObject({
      recordedBy: { name: "Juan", you: true },
      you: { memberIds: [h.juan.memberId], share: cop(90_000), paid: cop(180_000) },
    });
  });

  it("lists newest first from the date asked, at most `limit`, settlements and movements without her included", async () => {
    const h = await household();
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    await paysEqually(h.juan, 45_000, [h.juan.memberId, luis.memberId], h.groceries, "Gas");
    const settlement = await settles(h.juan, h.juan.memberId, h.ana.memberId, 50_000);
    const items = await activityOf(h.ana);
    expect(items.map((i) => [i.transaction.type, i.you.share])).toEqual([
      ["SETTLEMENT", null],
      ["EXPENSE", null],
    ]);
    expect(items[0]!.transaction.id).toBe(settlement.id);
    expect(items[0]!.memberNames).toEqual({ [h.juan.memberId]: "Juan", [h.ana.memberId]: "Ana" });
    expect(await activityOf(h.ana, "?from=2026-10-06")).toHaveLength(1);
    expect(await activityOf(h.ana, "?from=2026-10-01&limit=1")).toHaveLength(1);
  });

  it("stops at `to` when asked, so a past period lists only its own movements (ruling P310)", async () => {
    const h = await household();
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    const gas = await paysEqually(h.juan, 45_000, [h.juan.memberId, luis.memberId], h.groceries, "Gas");
    await settles(h.juan, h.juan.memberId, h.ana.memberId, 50_000);
    const items = await activityOf(h.ana, "?from=2026-10-01&to=2026-10-29");
    expect(items.map((i) => i.transaction.id)).toEqual([gas.id]);
    expect(await activityOf(h.ana, "?from=2026-10-01&to=2026-10-30")).toHaveLength(2);
    expect(await activityOf(h.ana, "?from=2026-10-10&to=2026-10-01")).toEqual([]);
  });

  it("answers nothing to someone outside every shared space", async () => {
    await household();
    const pedro = await registerUser("Pedro");
    expect(await activityOf(pedro)).toEqual([]);
  });

  it("refuses a request without a date or with a limit over 50, and one without a session", async () => {
    const ana = await registerUser("Ana");
    for (const query of ["", "?from=2026-13-01", "?from=2026-10-01&limit=51"]) {
      const response = await call(myActivity, "GET", `/api/v1/me/activity${query}`, { user: ana });
      expect((await problemOf(response))[0]).toBe(422);
    }
    const anonymous = await call(myActivity, "GET", "/api/v1/me/activity?from=2026-10-01");
    expect(await problemOf(anonymous)).toEqual([401, "Unauthenticated"]);
  });
});

describe("GET /api/v1/me/unified-view bySpace (ruling P306)", () => {
  it("gives Ana her share and what she paid in each space, her personal space first, broken down by category", async () => {
    const h = await household();
    await paysEqually(h.ana, 100_000, [h.ana.memberId, h.juan.memberId], h.groceries);
    const market = await post(recordExpense, h.ana.personal, "expenses", {
      description: "Market",
      amount: cop(30_000),
      date: "2026-10-07",
      categoryId: await categoryWithKey(h.ana.personal, "groceries"),
      accountId: h.ana.account,
    });
    expect(market.status).toBe(201);
    const response = await call(unifiedView, "GET", "/api/v1/me/unified-view?period=2026-10", {
      user: h.ana,
    });
    expect(response.status).toBe(200);
    const view = (await response.json()) as {
      consumption: { total: MoneyDto };
      bySpace: {
        space: { id: string; kind: string };
        consumed: MoneyDto;
        paid: MoneyDto;
        categories?: { name: string; color: string | null; amount: MoneyDto }[];
      }[];
    };
    expect(view.bySpace.map((s) => [s.space.kind, s.consumed, s.paid])).toEqual([
      ["PERSONAL", cop(30_000), cop(30_000)],
      ["SHARED", cop(50_000), cop(100_000)],
    ]);
    expect(view.consumption.total).toEqual(cop(80_000));
    // "Solo tú": her personal space's categories with their colors; a shared space lists none.
    expect(view.bySpace[0]!.categories).toEqual([
      {
        id: expect.any(String),
        name: expect.any(String),
        color: expect.stringMatching(/^[A-Z]+$/),
        amount: cop(30_000),
      },
    ]);
    expect(view.bySpace[1]!.categories).toBeUndefined();
  });
});
