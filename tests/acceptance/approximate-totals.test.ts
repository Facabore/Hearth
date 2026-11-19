import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as directSplit } from "@/app/api/v1/direct-splits/route";
import { GET as listFriends } from "@/app/api/v1/me/friends/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { FixedClock } from "@/shared/kernel";
import { call, registerUser, startTestApp, type TestUser } from "../support/app";
import { categoryWithKey, cop, household, newAccount, post, type MoneyDto } from "../support/ledger";
import { getUnifiedView, type UnifiedViewDto } from "../support/reporting";

/**
 * Ruling P342 (S6): "today" is 18 March 2041 in Bogotá, far from every other test's rate days. The rates stored on 1
 * March (4.100 COP per dollar) record the movements' account legs; those of 16 March (4.000, and 4.400 per euro) are
 * the latest by today, so the approximate totals read them.
 */
const NOW = new Date("2041-03-18T17:00:00Z");
const LEG_DAY = "2041-03-01";
const RATE_DAY = "2041-03-16";

let app: Container;
beforeAll(async () => {
  app = startTestApp({ clock: new FixedClock(NOW) });
  await app.pool.query(
    `INSERT INTO exchange_rates (date, base, quote, rate, source, fetched_at)
     VALUES ($1, 'USD', 'COP', '4100', 'test', now()), ($2, 'USD', 'COP', '4000', 'test', now()),
            ($2, 'EUR', 'COP', '4400', 'test', now())
     ON CONFLICT DO NOTHING`,
    [LEG_DAY, RATE_DAY],
  );
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const usd = (dollars: number): MoneyDto => ({ amount: String(dollars * 100), currency: "USD" });
const ars = (pesos: number): MoneyDto => ({ amount: String(pesos * 100), currency: "ARS" });

const viewOf = async (user: TestUser): Promise<UnifiedViewDto> => {
  const response = await getUnifiedView(user, { period: "2041-03" });
  expect(response.status).toBe(200);
  return (await response.json()) as UnifiedViewDto;
};

/** Ana, alone in her personal space, with a COP account and her groceries category. */
const ana = async () => {
  const user = await registerUser("Ana");
  return {
    user,
    bank: await newAccount(user, "Bancolombia", 5_000_000),
    groceries: await categoryWithKey(user, "groceries"),
  };
};
const spends = async (
  who: Awaited<ReturnType<typeof ana>>,
  amount: MoneyDto,
  extra: Record<string, unknown> = {},
) => {
  const response = await post(recordExpense, who.user, "expenses", {
    description: "Gasto",
    date: "2041-03-02",
    categoryId: who.groceries,
    amount,
    accountId: who.bank,
    ...extra,
  });
  expect(response.status).toBe(201);
};

describe("Inicio's month across currencies (P342, S6)", () => {
  it("lists the month per currency and adds it up in COP at today's rate, never at the movement's", async () => {
    const a = await ana();
    await spends(a, cop(1_240_000));
    await spends(a, usd(80));
    const view = await viewOf(a.user);
    expect(view.spending).toEqual({
      byCurrency: [cop(1_240_000), usd(80)],
      // 80 USD at today's 4.000 is 320.000 COP (the account paid 328.000 COP at 1 March's 4.100).
      approximate: { total: cop(1_560_000), unrated: [] },
    });
  });

  it("lists a currency with no rate today apart, adding nothing for it", async () => {
    const a = await ana();
    await spends(a, cop(100_000));
    await spends(a, ars(1_000), { accountAmount: cop(5_000) });
    const view = await viewOf(a.user);
    expect(view.spending).toEqual({
      byCurrency: [cop(100_000), ars(1_000)],
      approximate: { total: cop(100_000), unrated: [ars(1_000)] },
    });
  });

  it("answers a month in one currency as before, with no approximate figure", async () => {
    const a = await ana();
    await spends(a, cop(250_000));
    const view = await viewOf(a.user);
    expect(view.spending).toEqual({ byCurrency: [cop(250_000)] });
    expect(view.consumption.total).toEqual(cop(250_000));
    expect([view.otherCurrencySpaces, view.converted]).toEqual([[], undefined]);
  });
});

describe("Amigos' totals across currencies (P342, S6)", () => {
  /** Ana and Juan split directly: Ana pays 500.000 COP (Juan owes her 250.000 COP), Juan pays `taxi` (she owes half). */
  const debts = async (taxi: MoneyDto) => {
    const h = await household();
    const split = async (amount: MoneyDto, paid: { accountId: string } | { paidBy: "COUNTERPART" }) => {
      const response = await call(directSplit, "POST", "/api/v1/direct-splits", {
        user: h.ana,
        body: {
          counterpart: { kind: "MEMBER", memberId: h.juan.memberId },
          description: "Cena",
          date: "2041-03-05",
          categoryKey: "restaurants",
          amount,
          ...paid,
        },
      });
      expect(response.status).toBe(201);
    };
    await split(cop(500_000), { accountId: h.ana.account });
    await split(taxi, { paidBy: "COUNTERPART" });
    const response = await call(listFriends, "GET", "/api/v1/me/friends", { user: h.ana });
    expect(response.status).toBe(200);
    return (await response.json()) as {
      items: { name: string; nets?: MoneyDto[] }[];
      approximate?: unknown;
    };
  };

  it("adds what she is owed and what she owes in COP at today's rate; each debt stays in its currency", async () => {
    const friends = await debts(usd(60));
    expect(friends.items.find((f) => f.name === "Juan")?.nets).toEqual([cop(250_000), usd(-30)]);
    expect(friends.approximate).toEqual({
      currency: "COP",
      owedToYou: { total: cop(250_000), unrated: [] },
      // 30 USD at today's 4.000.
      youOwe: { total: cop(120_000), unrated: [] },
    });
  });

  it("lists a debt in a currency with no rate today apart, on its side", async () => {
    const friends = await debts(ars(2_000));
    expect(friends.approximate).toEqual({
      currency: "COP",
      owedToYou: { total: cop(250_000), unrated: [] },
      youOwe: { total: cop(0), unrated: [ars(1_000)] },
    });
  });

  it("answers debts in one currency as before, with no approximate totals", async () => {
    const friends = await debts(cop(60_000));
    expect(friends.items.find((f) => f.name === "Juan")?.nets).toEqual([cop(220_000)]);
    expect(friends).not.toHaveProperty("approximate");
  });
});
