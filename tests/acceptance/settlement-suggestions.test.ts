import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { GET as getSuggestions } from "@/app/api/v1/spaces/[spaceId]/balances/suggestions/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordSettlement } from "@/app/api/v1/spaces/[spaceId]/settlements/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import {
  balancesOf,
  cop,
  household,
  joinHousehold,
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

  it("collapses Ana owing Juan and Juan owing Luis into one payment from Ana to Luis", async () => {
    const { h, luis } = await trip();
    await paysFor(h.juan, h.groceries, [[h.ana.memberId, 100_000]]);
    await paysFor(luis, h.groceries, [[h.juan.memberId, 100_000]]);
    expect(await suggestionsOf(h.ana, h.spaceId)).toEqual([pays(h.ana.memberId, luis.memberId, 100_000)]);
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

  it("still answers for an archived space, which only reads (HU-E1-09, the read table of Task 18b)", async () => {
    const { h } = await trip();
    const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${h.spaceId}/archive`, {
      user: h.ana,
      params: { spaceId: h.spaceId },
    });
    expect(archived.status).toBe(204);
    expect(await suggestionsOf(h.juan, h.spaceId)).toEqual([]);
  });
});
