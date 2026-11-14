import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as myActivity } from "@/app/api/v1/me/activity/route";
import { GET as myTransactions } from "@/app/api/v1/me/transactions/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordContribution } from "@/app/api/v1/spaces/[spaceId]/fund-contributions/route";
import { POST as recordIncome } from "@/app/api/v1/spaces/[spaceId]/incomes/route";
import { POST as recordSettlement } from "@/app/api/v1/spaces/[spaceId]/settlements/route";
import { POST as recordTransfer } from "@/app/api/v1/spaces/[spaceId]/transfers/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { FixedClock } from "@/shared/kernel";
import { call, registerUser, startTestApp, type TestUser } from "../support/app";
import {
  categoryWithKey,
  cop,
  household,
  joinHousehold,
  newAccount,
  post,
  starterAccount,
  type HouseholdMember,
  type MoneyDto,
} from "../support/ledger";

let app: Container;
beforeAll(() => {
  // 2026-10-31 in Bogotá: the current period of a MONTHLY(1) personal space is 2026-10.
  app = startTestApp({ clock: new FixedClock(new Date("2026-10-31T15:00:00Z")) });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface ItemDto {
  space: { id: string; kind: string };
  transaction: { id: string; type: string };
  you: { memberIds: string[]; share: MoneyDto | null; paid: MoneyDto | null };
}
interface PageDto {
  totals: { share: MoneyDto; income: MoneyDto };
  items: ItemDto[];
  nextCursor: string | null;
}

const pageOf = async (user: TestUser, query = ""): Promise<PageDto> => {
  const response = await call(myTransactions, "GET", `/api/v1/me/transactions${query}`, { user });
  expect(response.status).toBe(200);
  return (await response.json()) as PageDto;
};
const activityOf = async (user: TestUser): Promise<ItemDto[]> => {
  const response = await call(myActivity, "GET", "/api/v1/me/activity?from=2026-10-01", { user });
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: ItemDto[] }).items;
};
const idOf = async (response: Response): Promise<string> => {
  const body = (await response.json()) as { id: string };
  expect([response.status, body]).toEqual([201, expect.objectContaining({ id: expect.any(String) })]);
  return body.id;
};

/**
 * Ruling P329: Ana, Juan and Luis in the household, one movement a day so the order is the date's. Ana is in some of
 * them (as payer, sharer, contributor, receiver or the one a settlement was made for) and out of the rest.
 */
const october = async () => {
  const h = await household();
  const luis = await joinHousehold(h, "Luis", "MEMBER");
  const fund = await newAccount(h.ana, "Household Fund", 0, "SHARED_FUND");
  const groceries = h.groceries;
  /** `payer` pays `pesos` on `date` from their own account, split equally among `among`. */
  const pays = async (
    payer: HouseholdMember,
    pesos: number,
    among: readonly HouseholdMember[],
    date: string,
    description: string,
  ) =>
    idOf(
      await post(recordExpense, payer, "expenses", {
        description,
        date,
        categoryId: groceries,
        amount: cop(pesos),
        payments: [{ memberId: payer.memberId, accountId: payer.account, amount: cop(pesos) }],
        split: { method: "EQUAL", participants: among.map((m) => ({ memberId: m.memberId })) },
      }),
    );
  const contributes = async (who: HouseholdMember, date: string) =>
    idOf(
      await post(recordContribution, who, "fund-contributions", {
        date,
        amount: cop(50_000),
        fundAccountId: fund,
        sourceAccountId: who.account,
      }),
    );
  const settles = async (
    payer: HouseholdMember,
    receiver: HouseholdMember,
    date: string,
    onBehalfOf?: HouseholdMember,
  ) =>
    idOf(
      await post(recordSettlement, h.juan, "settlements", {
        date,
        amount: cop(10_000),
        payerMemberId: payer.memberId,
        receivingMemberId: receiver.memberId,
        ...(onBehalfOf ? { onBehalfOfMemberId: onBehalfOf.memberId } : {}),
      }),
    );

  const juansContribution = await contributes(h.juan, "2026-10-02");
  const anasContribution = await contributes(h.ana, "2026-10-03");
  const ownMove = await idOf(
    await post(recordTransfer, h.ana.personal, "transfers", {
      date: "2026-10-04",
      amount: cop(100_000),
      sourceAccountId: h.ana.account,
      destinationAccountId: await starterAccount(h.ana.personal, "Ahorros"),
    }),
  );
  const gas = await pays(h.juan, 40_000, [h.juan, luis], "2026-10-05", "Gas");
  const market = await pays(h.juan, 100_000, [h.ana, h.juan], "2026-10-06", "Market");
  const gift = await pays(h.ana, 60_000, [h.juan, luis], "2026-10-07", "Gift");
  const dinner = await pays(luis, 90_000, [h.ana, luis], "2026-10-09", "Dinner");
  const luisPaysJuan = await settles(luis, h.juan, "2026-10-10");
  const forAna = await settles(h.juan, luis, "2026-10-11", h.ana);
  const toAna = await settles(h.juan, h.ana, "2026-10-12");
  const byAna = await settles(h.ana, h.juan, "2026-10-13");
  return {
    h,
    luis,
    /** What involves Ana, newest first; her own transfer is her personal space's. */
    involved: [byAna, toAna, forAna, dinner, gift, market, ownMove, anasContribution],
    ownMove,
    notHers: [luisPaysJuan, gas, juansContribution],
    gas,
    market,
    gift,
    anasContribution,
  };
};

describe("the personal space lists only what involves the person (ruling P329)", () => {
  it("keeps another space's movement only when it involves Ana, in Movimientos and in Recientes", async () => {
    const w = await october();
    const page = await pageOf(w.h.ana);
    const ids = page.items.map((i) => i.transaction.id);
    expect(ids).toEqual(w.involved);
    for (const id of w.notHers) expect(ids).not.toContain(id);
    expect(page.nextCursor).toBeNull();
    // Recientes answers the shared and direct spaces' part: the same movements but her personal one.
    expect((await activityOf(w.h.ana)).map((i) => i.transaction.id)).toEqual(
      w.involved.filter((id) => id !== w.ownMove),
    );
  });

  it("keeps the totals: her share of what she shares, and no one else's income", async () => {
    const w = await october();
    // Her half of the market (50.000) and of the dinner (45.000).
    expect((await pageOf(w.h.ana)).totals).toEqual({ share: cop(95_000), income: cop(0) });
    expect((await pageOf(w.h.ana, `?spaceId=${w.h.spaceId}`)).totals).toEqual({
      share: cop(95_000),
      income: cop(0),
    });
  });

  it("pages across what is not hers without repeating or skipping one of hers (P43)", async () => {
    const w = await october();
    const seen: string[] = [];
    let query = "?limit=2";
    for (let pages = 0; pages < 10; pages++) {
      const page = await pageOf(w.h.ana, query);
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((i) => i.transaction.id));
      if (page.nextCursor === null) break;
      query = `?limit=2&cursor=${encodeURIComponent(page.nextCursor)}`;
    }
    expect(seen).toEqual(w.involved);
  });

  it("shows each of the others what involves them: Luis the gas and the gift, never Ana's market", async () => {
    const w = await october();
    const luis = (await pageOf(w.luis)).items.map((i) => i.transaction.id);
    expect(luis).toEqual(expect.arrayContaining([w.gas, w.gift]));
    expect(luis).not.toContain(w.market);
    const juans = (await pageOf(w.h.juan)).items.map((i) => i.transaction.id);
    expect(juans).toEqual(expect.arrayContaining([w.gas, w.market, w.gift]));
    expect(juans).not.toContain(w.anasContribution);
  });

  it("still filters by account: her account's movements, the household's included (P327)", async () => {
    const w = await october();
    expect(
      (await pageOf(w.h.ana, `?accountId=${w.h.ana.account}`)).items.map((i) => i.transaction.id),
    ).toEqual([w.gift, w.ownMove, w.anasContribution]);
  });

  it("lists exactly what it listed for someone with only the personal space, totals included", async () => {
    const pedro = await registerUser("Pedro");
    const bank = await newAccount(pedro, "Banco", 1_000_000);
    const lunch = await idOf(
      await post(recordExpense, pedro, "expenses", {
        description: "Lunch",
        date: "2026-10-03",
        amount: cop(20_000),
        categoryId: await categoryWithKey(pedro, "groceries"),
        accountId: bank,
      }),
    );
    const move = await idOf(
      await post(recordTransfer, pedro, "transfers", {
        date: "2026-10-04",
        amount: cop(5_000),
        sourceAccountId: bank,
        destinationAccountId: await starterAccount(pedro, "Ahorros"),
      }),
    );
    const salary = await idOf(
      await post(recordIncome, pedro, "incomes", {
        date: "2026-10-05",
        amount: cop(1_000_000),
        categoryId: await categoryWithKey(pedro, "salary"),
        accountId: bank,
      }),
    );
    const page = await pageOf(pedro);
    expect(page.items.map((i) => i.transaction.id)).toEqual([salary, move, lunch]);
    expect(page.totals).toEqual({ share: cop(20_000), income: cop(1_000_000) });
    expect(await activityOf(pedro)).toEqual([]);
  });
});
