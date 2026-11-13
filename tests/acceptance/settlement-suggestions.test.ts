import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { GET as getSuggestions } from "@/app/api/v1/spaces/[spaceId]/balances/suggestions/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordSettlement } from "@/app/api/v1/spaces/[spaceId]/settlements/route";
import { DELETE as deleteTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import {
  balancesOf,
  cop,
  household,
  joinHousehold,
  newAccount,
  paysEqually,
  post,
  type HouseholdMember,
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

interface SuggestionDto {
  payerMemberId: string;
  receivingMemberId: string;
  amount: MoneyDto;
}
const suggestionsPath = (spaceId: string) => `/api/v1/spaces/${spaceId}/balances/suggestions`;
const suggestionsOf = async (user: TestUser, spaceId: string): Promise<SuggestionDto[]> => {
  const response = await call(getSuggestions, "GET", suggestionsPath(spaceId), { user, params: { spaceId } });
  expect(response.status).toBe(200);
  return ((await response.json()) as { suggestions: SuggestionDto[] }).suggestions;
};
const pays = (payerMemberId: string, receivingMemberId: string, pesos: number): SuggestionDto => ({
  payerMemberId,
  receivingMemberId,
  amount: cop(pesos),
});
/** `payer` pays from their own account what each listed member owes, split EXACT; the payer takes no share. */
const paysFor = async (payer: HouseholdMember, categoryId: string, owed: [string, number][]) => {
  const pesos = owed.reduce((sum, [, part]) => sum + part, 0);
  const response = await post(recordExpense, payer, "expenses", {
    description: "Trip",
    date: "2026-10-05",
    categoryId,
    amount: cop(pesos),
    payments: [{ memberId: payer.memberId, accountId: payer.account, amount: cop(pesos) }],
    split: {
      method: "EXACT",
      participants: owed.map(([memberId, part]) => ({ memberId, amount: cop(part) })),
    },
  });
  expect(response.status).toBe(201);
};
/** HU-E5-03 Background: "Trip 2026" with Ana, Juan and Luis (the household helper with Luis joined). */
const trip = async () => {
  const h = await household();
  return { h, luis: await joinHousehold(h, "Luis", "MEMBER") };
};

describe("settlement suggestions (HU-E5-03)", () => {
  it("suggests that Juan pays Ana 100,000 COP and Luis pays Ana 50,000 COP", async () => {
    const { h, luis } = await trip();
    await paysFor(h.ana, h.groceries, [
      [h.juan.memberId, 100_000],
      [luis.memberId, 50_000],
    ]);
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(150_000)],
      [h.juan.memberId, cop(-100_000)],
      [luis.memberId, cop(-50_000)],
    ]);
    expect(await suggestionsOf(h.ana, h.spaceId)).toEqual([
      pays(h.juan.memberId, h.ana.memberId, 100_000),
      pays(luis.memberId, h.ana.memberId, 50_000),
    ]);
  });

  it("has Luis pay Juan, who paid for him, and Juan pay Ana, never Luis pay Ana (P323)", async () => {
    const { h, luis } = await trip();
    await paysFor(h.ana, h.groceries, [[h.juan.memberId, 100_000]]);
    await paysFor(h.juan, h.groceries, [[luis.memberId, 100_000]]);
    expect(await suggestionsOf(h.ana, h.spaceId)).toEqual([
      pays(h.juan.memberId, h.ana.memberId, 100_000),
      pays(luis.memberId, h.juan.memberId, 100_000),
    ]);
  });

  it("nets each pair as on staging: Luis pays Juan 10,333 and Juan pays Ana 14,666 (P323, S5)", async () => {
    // Ana (Kamilox) paid 50,000 with Juan (Yuberley); Juan paid 16,000 and 15,000 split in three with Luis (Roger).
    const { h, luis } = await trip();
    const three = [h.ana.memberId, h.juan.memberId, luis.memberId];
    await paysEqually(h.ana, 50_000, [h.ana.memberId, h.juan.memberId], h.groceries);
    await paysEqually(h.juan, 16_000, three, h.groceries);
    await paysEqually(h.juan, 15_000, three, h.groceries);
    expect(await suggestionsOf(luis, h.spaceId)).toEqual([
      pays(h.juan.memberId, h.ana.memberId, 14_666),
      pays(luis.memberId, h.juan.memberId, 10_333),
    ]);
    // S4: every net stays what it was; the pairs only say who pays whom.
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(14_666)],
      [h.juan.memberId, cop(-4_333)],
      [luis.memberId, cop(-10_333)],
    ]);
  });

  it("leaves out deleted and fund-paid expenses (D5)", async () => {
    const { h, luis } = await trip();
    const fund = await newAccount(h.ana, "Household Fund", 1_500_000, "SHARED_FUND");
    const rent = await post(recordExpense, h.ana, "expenses", {
      description: "Rent",
      date: "2026-10-01",
      categoryId: h.groceries,
      amount: cop(90_000),
      payments: [{ memberId: null, accountId: fund, amount: cop(90_000) }],
      split: { method: "EQUAL", participants: [{ memberId: h.juan.memberId }, { memberId: luis.memberId }] },
    });
    expect(rent.status).toBe(201);
    const dinner = await paysEqually(h.ana, 60_000, [h.juan.memberId, luis.memberId], h.groceries);
    const deleted = await call(
      deleteTransaction,
      "DELETE",
      `/api/v1/spaces/${h.spaceId}/transactions/${dinner.id}`,
      { user: h.ana, params: { spaceId: h.spaceId, transactionId: dinner.id } },
    );
    expect(deleted.status).toBe(204);
    expect(await suggestionsOf(h.ana, h.spaceId)).toEqual([]);
  });

  it("moves Luis's debt to Juan when Juan pays Ana for him, and clears it when Juan gives it away (P322)", async () => {
    const { h, luis } = await trip();
    await paysFor(h.ana, h.groceries, [[luis.memberId, 100_000]]);
    const forLuis = { date: "2026-10-30", amount: cop(40_000), payerMemberId: h.juan.memberId };
    const loan = await post(recordSettlement, h.juan, "settlements", {
      ...forLuis,
      receivingMemberId: h.ana.memberId,
      onBehalfOfMemberId: luis.memberId,
    });
    expect(loan.status).toBe(201);
    expect(await suggestionsOf(h.ana, h.spaceId)).toEqual([
      pays(luis.memberId, h.ana.memberId, 60_000),
      pays(luis.memberId, h.juan.memberId, 40_000),
    ]);
    const gift = await post(recordSettlement, h.juan, "settlements", {
      ...forLuis,
      receivingMemberId: h.ana.memberId,
      onBehalfOfMemberId: luis.memberId,
      gift: true,
    });
    expect(gift.status).toBe(201);
    // The gift clears only what this second payment made Luis owe Juan.
    expect(await suggestionsOf(h.ana, h.spaceId)).toEqual([
      pays(luis.memberId, h.juan.memberId, 40_000),
      pays(luis.memberId, h.ana.memberId, 20_000),
    ]);
  });

  it("returns no suggestions for a settled group", async () => {
    const { h } = await trip();
    expect(await suggestionsOf(h.ana, h.spaceId)).toEqual([]);
  });

  it("records an accepted suggestion as a regular settlement, which clears Juan's part", async () => {
    const { h, luis } = await trip();
    await paysFor(h.ana, h.groceries, [
      [h.juan.memberId, 100_000],
      [luis.memberId, 50_000],
    ]);
    const [juanPaysAna] = await suggestionsOf(h.juan, h.spaceId);
    const settled = await post(recordSettlement, h.juan, "settlements", {
      date: "2026-10-30",
      ...juanPaysAna,
    });
    expect(settled.status).toBe(201);
    expect(await settled.json()).toMatchObject({
      type: "SETTLEMENT",
      payerMemberId: h.juan.memberId,
      receivingMemberId: h.ana.memberId,
      amount: cop(100_000),
    });
    expect(await suggestionsOf(h.ana, h.spaceId)).toEqual([pays(luis.memberId, h.ana.memberId, 50_000)]);
  });

  it("clears every balance once all the suggestions are accepted", async () => {
    const { h, luis } = await trip();
    await paysFor(h.ana, h.groceries, [
      [h.juan.memberId, 100_000],
      [luis.memberId, 50_000],
    ]);
    const members = [h.ana, h.juan, luis];
    for (const suggestion of await suggestionsOf(h.ana, h.spaceId)) {
      const payer = members.find((m) => m.memberId === suggestion.payerMemberId)!;
      const settled = await post(recordSettlement, payer, "settlements", {
        date: "2026-10-30",
        ...suggestion,
      });
      expect(settled.status).toBe(201);
    }
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(0)],
      [luis.memberId, cop(0)],
    ]);
    expect(await suggestionsOf(h.ana, h.spaceId)).toEqual([]);
  });

  it("lets a viewer read the suggestions and hides them from everyone else", async () => {
    const { h } = await trip();
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    expect(await suggestionsOf(sofi, h.spaceId)).toEqual([]);
    const marta = await registerUser("Marta");
    for (const spaceId of [h.spaceId, "not-a-uuid"]) {
      const response = await call(getSuggestions, "GET", suggestionsPath(spaceId), {
        user: marta,
        params: { spaceId },
      });
      expect(await problemOf(response)).toEqual([404, "SpaceNotFound"]);
    }
    const anonymous = await call(getSuggestions, "GET", suggestionsPath(h.spaceId), {
      params: { spaceId: h.spaceId },
    });
    expect(await problemOf(anonymous)).toEqual([401, "Unauthenticated"]);
  });

  it("still answers for an archived space, which only reads (HU-E1-09, the archived space's read table)", async () => {
    const { h } = await trip();
    const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${h.spaceId}/archive`, {
      user: h.ana,
      params: { spaceId: h.spaceId },
    });
    expect(archived.status).toBe(204);
    expect(await suggestionsOf(h.juan, h.spaceId)).toEqual([]);
  });
});
