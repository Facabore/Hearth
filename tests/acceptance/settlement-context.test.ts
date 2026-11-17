import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as directSplit } from "@/app/api/v1/direct-splits/route";
import { GET as myActivity } from "@/app/api/v1/me/activity/route";
import { GET as myTransactions } from "@/app/api/v1/me/transactions/route";
import { POST as recordSettlement } from "@/app/api/v1/spaces/[spaceId]/settlements/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, startTestApp, type TestUser } from "../support/app";
import {
  cop,
  household,
  joinHousehold,
  memberIdOf,
  paysEqually,
  post,
  type Household,
  type MoneyDto,
} from "../support/ledger";
import { actingIn } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface SettlementContextDto {
  kind: "PAID" | "LENT" | "PAID_AND_LENT";
  paid: MoneyDto;
  lent: MoneyDto;
}

interface ItemDto {
  transaction: { id: string; type: string };
  you: { memberIds: string[]; settlement?: SettlementContextDto };
}

const activityOf = async (user: TestUser): Promise<ItemDto[]> => {
  const response = await call(myActivity, "GET", "/api/v1/me/activity?from=2026-10-01", { user });
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: ItemDto[] }).items;
};

const movimientosOf = async (user: TestUser): Promise<ItemDto[]> => {
  const response = await call(myTransactions, "GET", "/api/v1/me/transactions?period=2026-10", { user });
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: ItemDto[] }).items;
};

/** What each listed movement says, by id: its settlement context, or "none" when it carries none. */
const contextsIn = (items: readonly ItemDto[]) =>
  Object.fromEntries(items.map((item) => [item.transaction.id, item.you.settlement ?? "none"]));

/** Both the personal Movimientos and Inicio's Recientes give `user` the same context for every movement. */
const contextsOf = async (user: TestUser) => {
  const recent = contextsIn(await activityOf(user));
  expect(contextsIn(await movimientosOf(user))).toMatchObject(recent);
  return recent;
};

const settle = async (
  recorder: TestUser,
  payerMemberId: string,
  receivingMemberId: string,
  pesos: number,
  more: { date?: string; reason?: "FORGIVENESS"; onBehalfOfMemberId?: string } = {},
): Promise<string> => {
  const response = await post(recordSettlement, recorder, "settlements", {
    date: more.date ?? "2026-10-20",
    amount: cop(pesos),
    payerMemberId,
    receivingMemberId,
    ...(more.reason ? { reason: more.reason } : {}),
    ...(more.onBehalfOfMemberId ? { onBehalfOfMemberId: more.onBehalfOfMemberId } : {}),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
};

/** Juan paid a 200,000 COP dinner for both, recorded by Ana in their direct space: she owes him 100,000. */
const directDinner = async (h: Household) => {
  const response = await call(directSplit, "POST", "/api/v1/direct-splits", {
    user: h.ana,
    body: {
      counterpart: { kind: "MEMBER", memberId: h.juan.memberId },
      paidBy: "COUNTERPART",
      description: "Cena",
      date: "2026-10-10",
      categoryKey: "restaurants",
      amount: cop(200_000),
    },
  });
  expect(response.status).toBe(201);
  const { spaceId } = (await response.json()) as { spaceId: string };
  return {
    spaceId,
    ana: { user: actingIn(h.ana.personal, spaceId), memberId: await memberIdOf(h.ana, spaceId, "Ana") },
    juan: { user: actingIn(h.juan.personal, spaceId), memberId: await memberIdOf(h.ana, spaceId, "Juan") },
  };
};

describe("what money handed between two people did, in Movimientos and Inicio (ruling P339, S9)", () => {
  it("in a direct space: pays what was owed, then lends past it, then lends when even, from each side", async () => {
    const h = await household();
    const d = await directDinner(h);
    // Ana owes 100,000: 60,000 pays; then 70,000 pays the 40,000 left and lends 30,000; then Juan owes her 30,000.
    const paid = await settle(d.ana.user, d.ana.memberId, d.juan.memberId, 60_000, { date: "2026-10-11" });
    const both = await settle(d.ana.user, d.ana.memberId, d.juan.memberId, 70_000, { date: "2026-10-12" });
    // Juan pays her the 30,000 back, then lends her 25,000 more once they are even.
    const back = await settle(d.ana.user, d.juan.memberId, d.ana.memberId, 30_000, { date: "2026-10-13" });
    const lent = await settle(d.ana.user, d.juan.memberId, d.ana.memberId, 25_000, { date: "2026-10-14" });

    const expected = {
      [paid]: { kind: "PAID", paid: cop(60_000), lent: cop(0) },
      [both]: { kind: "PAID_AND_LENT", paid: cop(40_000), lent: cop(30_000) },
      [back]: { kind: "PAID", paid: cop(30_000), lent: cop(0) },
      [lent]: { kind: "LENT", paid: cop(0), lent: cop(25_000) },
    };
    expect(await contextsOf(h.ana)).toMatchObject(expected);
    // The receiver reads the same context: Juan was paid, paid and lent, and so on.
    expect(await contextsOf(h.juan)).toMatchObject(expected);
  });

  it("in a shared household: reads the pair's own debt, never the payer's whole net, and ties by when recorded", async () => {
    const h = await household();
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    // Luis pays 60,000 for Ana and himself: Ana owes Luis 30,000 and nothing to Juan, though her net is −30,000.
    await paysEqually(luis, 60_000, [h.ana.memberId, luis.memberId], h.groceries);
    const toJuan = await settle(h.ana, h.ana.memberId, h.juan.memberId, 20_000, { date: "2026-10-20" });
    const toLuis = await settle(h.ana, h.ana.memberId, luis.memberId, 50_000, { date: "2026-10-21" });
    // Juan owes Ana the 20,000 she lent him: two payments the same day, the one recorded first pays it back.
    const first = await settle(h.juan, h.juan.memberId, h.ana.memberId, 20_000, { date: "2026-10-22" });
    const second = await settle(h.juan, h.juan.memberId, h.ana.memberId, 20_000, { date: "2026-10-22" });

    expect(await contextsOf(h.ana)).toMatchObject({
      [toJuan]: { kind: "LENT", paid: cop(0), lent: cop(20_000) },
      [toLuis]: { kind: "PAID_AND_LENT", paid: cop(30_000), lent: cop(20_000) },
      [first]: { kind: "PAID", paid: cop(20_000), lent: cop(0) },
      [second]: { kind: "LENT", paid: cop(0), lent: cop(20_000) },
    });
    expect(await contextsOf(h.juan)).toMatchObject({
      [toJuan]: { kind: "LENT" },
      [first]: { kind: "PAID" },
      [second]: { kind: "LENT" },
    });
    expect(await contextsOf(luis)).toMatchObject({ [toLuis]: { kind: "PAID_AND_LENT" } });
  });

  it("gives a forgiveness, a gift and a payment made for someone else no context: they keep their words", async () => {
    const h = await household();
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    await paysEqually(luis, 60_000, [h.ana.memberId, luis.memberId], h.groceries);
    await paysEqually(h.juan, 40_000, [h.ana.memberId, h.juan.memberId], h.groceries);
    // Luis forgives 10,000 of what Ana owes him; Juan pays Luis 5,000 of Ana's debt for her, then 5,000 as a gift.
    const forgiven = await settle(luis, h.ana.memberId, luis.memberId, 10_000, { reason: "FORGIVENESS" });
    const forHer = await settle(h.juan, h.juan.memberId, luis.memberId, 5_000, {
      onBehalfOfMemberId: h.ana.memberId,
    });
    const gift = await post(recordSettlement, h.juan, "settlements", {
      date: "2026-10-20",
      amount: cop(5_000),
      payerMemberId: h.juan.memberId,
      receivingMemberId: luis.memberId,
      onBehalfOfMemberId: h.ana.memberId,
      gift: true,
    });
    expect(gift.status).toBe(201);
    // What Ana pays Luis after them pays what is left of her debt: 30,000 − 10,000 − 5,000 − 5,000 = 10,000.
    const after = await settle(h.ana, h.ana.memberId, luis.memberId, 10_000, { date: "2026-10-21" });

    const ana = await contextsOf(h.ana);
    expect(ana[forgiven]).toBe("none");
    expect(ana[forHer]).toBe("none");
    expect(ana[after]).toEqual({ kind: "PAID", paid: cop(10_000), lent: cop(0) });
    const juan = await activityOf(h.juan);
    const settlements = juan.filter((item) => item.transaction.type === "SETTLEMENT");
    expect(settlements.length).toBeGreaterThanOrEqual(2);
    expect(settlements.map((item) => item.you.settlement)).toEqual(settlements.map(() => undefined));
  });
});
