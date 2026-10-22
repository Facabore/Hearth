import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { POST as archiveAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/archive/route";
import { call, problemOf, startTestApp, type TestUser } from "../support/app";
import { categoryWithKey, cop, newAccount, post } from "../support/ledger";
import { cashFlowOf, cashFlowRoute, type CashFlowDto } from "../support/reporting";
import {
  archiveHousehold,
  DEFINITION_DAY_CLOCK,
  defined,
  endRecurrence,
  householdWithFund,
  rentBody,
} from "../support/recurrences";

let app: Container;
beforeAll(() => {
  app = startTestApp({ clock: DEFINITION_DAY_CLOCK });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** The scheduler's job handles every active recurrence of the database, so each test ends what it defined. */
const toEnd: { spaceId: string; user: TestUser; id: string }[] = [];
afterEach(async () => {
  for (const { spaceId, user, id } of toEnd.splice(0)) {
    const ended = await endRecurrence(user, spaceId, id);
    if (ended.status !== 200) throw new Error(`ending ${id} failed with status ${ended.status}`);
  }
});

const flowOf = async (user: TestUser, days: string): Promise<CashFlowDto> => {
  const response = await cashFlowOf(user, days);
  expect(response.status).toBe(200);
  return (await response.json()) as CashFlowDto;
};

describe("the cash-flow calendar (#150, rulings P238–P240 of M6c)", () => {
  it("projects Ana's own accounts over 60 days, leaving out the rent the fund pays", async () => {
    const h = await householdWithFund();
    const salary = await defined(h.ana.personal, h.ana.personal.spaceId, {
      description: "Salario",
      amount: cop(3_000_000),
      template: {
        type: "INCOME",
        categoryId: await categoryWithKey(h.ana.personal, "salary"),
        accountId: h.ana.account,
      },
      schedule: { kind: "MONTHLY", day: 30 },
      mode: "AUTO",
      startDate: "2026-10-30",
    });
    const internet = await defined(
      h.ana,
      h.spaceId,
      rentBody(h, {
        description: "Internet",
        amount: cop(120_000),
        template: {
          type: "EXPENSE",
          categoryId: h.utilities,
          payer: { memberId: h.ana.memberId, accountId: h.ana.account },
        },
        schedule: { kind: "MONTHLY", day: 5 },
        startDate: "2026-11-05",
      }),
    );
    // The fund pays the Rent: it moves no account of Ana's, so it is not hers to see.
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    toEnd.push(
      { spaceId: h.ana.personal.spaceId, user: h.ana.personal, id: salary.id },
      { spaceId: h.spaceId, user: h.ana, id: internet.id },
      { spaceId: h.spaceId, user: h.ana, id: rent.id },
    );
    const flow = await flowOf(h.ana.personal, "60");
    expect(flow).toMatchObject({
      from: "2026-10-28",
      through: "2026-12-26",
      days: 60,
      opening: cop(2_000_000),
    });
    expect(
      flow.dates.map((d) => [d.date, d.movements.map((m) => [m.description, m.effect]), d.balanceAfter]),
    ).toEqual([
      ["2026-10-30", [["Salario", cop(3_000_000)]], cop(5_000_000)],
      ["2026-11-05", [["Internet", cop(-120_000)]], cop(4_880_000)],
      ["2026-11-30", [["Salario", cop(3_000_000)]], cop(7_880_000)],
      ["2026-12-05", [["Internet", cop(-120_000)]], cop(7_760_000)],
    ]);
    expect(flow.totals).toEqual({
      incoming: cop(6_000_000),
      outgoing: cop(240_000),
      closing: cop(7_760_000),
    });
    expect(flow.lowest).toEqual({ date: "2026-10-28", balance: cop(2_000_000) });
  });

  it("leaves out another member's bill: Juan's phone moves his account, not Ana's (ruling P239)", async () => {
    const h = await householdWithFund();
    const phone = await defined(
      h.juan,
      h.spaceId,
      rentBody(h, {
        description: "Juan's phone",
        amount: cop(80_000),
        template: {
          type: "EXPENSE",
          categoryId: h.utilities,
          payer: { memberId: h.juan.memberId, accountId: h.juan.account },
        },
        schedule: { kind: "MONTHLY", day: 5 },
        startDate: "2026-11-05",
      }),
    );
    toEnd.push({ spaceId: h.spaceId, user: h.juan, id: phone.id });
    const ana = await flowOf(h.ana.personal, "60");
    expect(ana.dates).toEqual([]);
    const juan = await flowOf(h.juan.personal, "60");
    expect(juan.dates.map((d) => [d.date, d.movements.map((m) => [m.description, m.effect])])).toEqual([
      ["2026-11-05", [["Juan's phone", cop(-80_000)]]],
      ["2026-12-05", [["Juan's phone", cop(-80_000)]]],
    ]);
  });

  it("counts a transfer by the accounts it touches: out to savings lowers her money, between two counted accounts or into an archived one it follows P240", async () => {
    const h = await householdWithFund();
    const savings = await newAccount(h.ana.personal, "Ahorros", 0, "SAVINGS");
    const nequi = await newAccount(h.ana.personal, "Nequi", 0, "WALLET");
    const old = await newAccount(h.ana.personal, "Viejo", 0, "WALLET");
    const transfer = (description: string, to: string, pesos: number, day: number) =>
      defined(h.ana.personal, h.ana.personal.spaceId, {
        description,
        amount: cop(pesos),
        template: { type: "TRANSFER", sourceAccountId: h.ana.account, destinationAccountId: to },
        schedule: { kind: "MONTHLY", day },
        mode: "AUTO",
        startDate: `2026-11-${day}`,
      });
    const created = [
      await transfer("To savings", savings, 500_000, 10),
      await transfer("To Nequi", nequi, 100_000, 12),
      await transfer("To the old wallet", old, 50_000, 14),
    ];
    for (const { id } of created) toEnd.push({ spaceId: h.ana.personal.spaceId, user: h.ana.personal, id });
    const archived = await call(
      archiveAccount,
      "POST",
      `/api/v1/spaces/${h.ana.personal.spaceId}/accounts/${old}/archive`,
      {
        user: h.ana.personal,
        params: { spaceId: h.ana.personal.spaceId, accountId: old },
      },
    );
    expect(archived.status).toBe(200);
    const flow = await flowOf(h.ana.personal, "30");
    expect(
      flow.dates.map((d) => [d.date, d.movements.map((m) => [m.description, m.effect]), d.balanceAfter]),
    ).toEqual([
      ["2026-11-10", [["To savings", cop(-500_000)]], cop(1_500_000)],
      ["2026-11-12", [["To Nequi", cop(0)]], cop(1_500_000)],
      ["2026-11-14", [["To the old wallet", cop(-50_000)]], cop(1_450_000)],
    ]);
    expect(flow.totals).toEqual({ incoming: cop(0), outgoing: cop(550_000), closing: cop(1_450_000) });
  });

  it("leaves out an archived space: Ana's Internet in a household that was archived no longer shows", async () => {
    const h = await householdWithFund();
    const internet = await defined(
      h.ana,
      h.spaceId,
      rentBody(h, {
        description: "Internet",
        amount: cop(120_000),
        template: {
          type: "EXPENSE",
          categoryId: h.utilities,
          payer: { memberId: h.ana.memberId, accountId: h.ana.account },
        },
        schedule: { kind: "MONTHLY", day: 5 },
        startDate: "2026-11-05",
      }),
    );
    try {
      expect((await flowOf(h.ana.personal, "30")).dates.map((d) => d.date)).toEqual(["2026-11-05"]);
      await archiveHousehold(h);
      expect((await flowOf(h.ana.personal, "30")).dates).toEqual([]);
    } finally {
      // An archived space refuses every write, ending included (HU-E1-09), so the job must not find it in the database.
      await app.pool.query("UPDATE recurrences SET ended_at = now(), updated_at = now() WHERE id = $1", [
        internet.id,
      ]);
    }
  });

  it("projects only known items: a large one-off expense today lowers today's money and adds no future date (ruling P245)", async () => {
    const h = await householdWithFund();
    expect(
      (
        await post(recordExpense, h.ana, "expenses", {
          description: "Laptop",
          date: "2026-10-28",
          categoryId: h.groceries,
          amount: cop(900_000),
          accountId: h.ana.account,
        })
      ).status,
    ).toBe(201);
    const flow = await flowOf(h.ana.personal, "60");
    expect([flow.opening, flow.dates, flow.lowest]).toEqual([
      cop(1_100_000),
      [],
      { date: "2026-10-28", balance: cop(1_100_000) },
    ]);
  });

  it("answers 30 days by default and refuses any other window", async () => {
    const h = await householdWithFund();
    const flow = (await (
      await call(cashFlowRoute, "GET", "/api/v1/me/cash-flow", { user: h.ana.personal })
    ).json()) as CashFlowDto;
    expect([flow.days, flow.through]).toEqual([30, "2026-11-26"]);
    expect(await problemOf(await cashFlowOf(h.ana.personal, "45"))).toEqual([422, "ValidationFailed"]);
  });
});
