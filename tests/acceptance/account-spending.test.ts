import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordIncome } from "@/app/api/v1/spaces/[spaceId]/incomes/route";
import { POST as recordTransfer } from "@/app/api/v1/spaces/[spaceId]/transfers/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { problemOf, registerUser, startTestApp } from "../support/app";
import {
  categoryWithKey,
  cop,
  household,
  newAccount,
  post,
  starterAccount,
  type Household,
} from "../support/ledger";
import {
  contribute,
  getPersonalSpendingByGroup,
  getSpendingByGroup,
  spend,
  type PersonalSpendingByGroupDto,
  type SpendingByGroupDto,
} from "../support/reporting";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface AccountFiguresDto {
  account?: {
    id: string;
    in: ReturnType<typeof cop>;
    out: ReturnType<typeof cop>;
    movedToOwnAccounts: ReturnType<typeof cop>;
  };
}
type Counted = { movements?: number };

/** Every group and category of a breakdown, which `movements` must be absent from without accountId. */
const nodesOf = (groups: { categories: object[] }[]) => groups.flatMap((g) => [g, ...g.categories]);

/**
 * Ruling P327 (board "Cuenta · Estadísticas · #315"): in November Ana's Bancolombia receives her salary, pays
 * Household's rent and a delivery, moves 500,000 to her Ahorros and pays 160,000 into Household's fund; Juan's
 * spending and her other account's never count.
 */
const bancolombiaNovember = async (h: Household) => {
  const ana = h.ana.personal;
  await post(recordIncome, ana, "incomes", {
    description: "Salario noviembre",
    amount: cop(3_200_000),
    date: "2026-11-10",
    categoryId: await categoryWithKey(ana, "salary"),
    accountId: h.ana.account,
  });
  await post(recordTransfer, ana, "transfers", {
    date: "2026-11-02",
    amount: cop(500_000),
    sourceAccountId: h.ana.account,
    destinationAccountId: await starterAccount(ana, "Ahorros"),
  });
  await spend(h.ana, await categoryWithKey(h.ana, "rent"), 2_000_000, "2026-11-01");
  await spend(h.ana, await categoryWithKey(h.ana, "restaurants"), 64_000, "2026-11-12");
  // Not hers to count: Juan's expense, and one she paid from another account of hers.
  await spend(h.juan, h.groceries, 240_000, "2026-11-04");
  const nequi = await newAccount(ana, "Nequi", 1_000_000);
  await spend({ ...h.ana, account: nequi }, h.groceries, 90_000, "2026-11-05");
  // Outside November.
  await spend(h.ana, h.groceries, 70_000, "2026-12-01");
  const fund = await newAccount(h.ana, "Fondo de Hogar", 0, "SHARED_FUND");
  await contribute(h.ana, fund, 160_000, "2026-11-02");
  return { fund };
};

describe("an account's own breakdown over HTTP (ruling P327)", () => {
  it("counts what Ana's Bancolombia paid in every space of hers, and what came in, went out and moved to her accounts (@critical)", async () => {
    const h = await household();
    await bancolombiaNovember(h);
    const ana = h.ana.personal;
    const response = await getPersonalSpendingByGroup(ana, { period: "2026-11", accountId: h.ana.account });
    expect(response.status).toBe(200);
    const breakdown = (await response.json()) as PersonalSpendingByGroupDto & AccountFiguresDto;
    expect(breakdown.total).toEqual(cop(2_064_000));
    expect(
      breakdown.groups.map((g) => [g.key, g.total, g.share, (g as Counted).movements, g.categories.length]),
    ).toEqual([
      ["housing", cop(2_000_000), "96.90", 1, 1],
      ["food", cop(64_000), "3.10", 1, 1],
    ]);
    expect(breakdown.groups[1]!.categories.map((c) => [c.key, (c as Counted).movements])).toEqual([
      ["restaurants", 1],
    ]);
    // Out: what it paid of expenses, the transfer to her Ahorros and her contribution to the fund.
    expect(breakdown.account).toEqual({
      id: h.ana.account,
      in: cop(3_200_000),
      out: cop(2_724_000),
      movedToOwnAccounts: cop(500_000),
    });
  });

  it("answers without accountId as before: her shares, no account figures and no counts", async () => {
    const h = await household();
    await bancolombiaNovember(h);
    const plain = (await (
      await getPersonalSpendingByGroup(h.ana.personal, { period: "2026-11" })
    ).json()) as PersonalSpendingByGroupDto & AccountFiguresDto;
    expect(plain).not.toHaveProperty("account");
    for (const node of nodesOf(plain.groups)) expect(node).not.toHaveProperty("movements");
    const space = (await (
      await getSpendingByGroup(h.ana, h.spaceId, { period: "2026-11" })
    ).json()) as SpendingByGroupDto & AccountFiguresDto;
    expect(space).not.toHaveProperty("account");
    for (const node of nodesOf(space.groups)) expect(node).not.toHaveProperty("movements");
    // Household's breakdown still counts every expense, whoever paid it: 2,000,000 + 64,000 + 240,000 + 90,000.
    expect(space.total).toEqual(cop(2_394_000));
  });

  it("counts what Household's fund paid for every member, and the contributions it received", async () => {
    const h = await household();
    const fund = await newAccount(h.ana, "Fondo de Hogar", 0, "SHARED_FUND");
    await contribute(h.juan, fund, 2_320_000, "2026-11-10");
    await contribute(h.ana, fund, 160_000, "2026-11-02");
    await spend(h.ana, h.groceries, 300_000, "2026-11-14", fund);
    await spend(h.ana, await categoryWithKey(h.ana, "utilities"), 110_000, "2026-11-05", fund);
    // Paid by Ana from her own account: not the fund's.
    await spend(h.ana, await categoryWithKey(h.ana, "rent"), 1_000_000, "2026-11-01");
    const response = await getSpendingByGroup(h.juan, h.spaceId, { period: "2026-11", accountId: fund });
    expect(response.status).toBe(200);
    const breakdown = (await response.json()) as SpendingByGroupDto & AccountFiguresDto;
    expect(breakdown.total).toEqual(cop(410_000));
    expect(breakdown.groups.map((g) => [g.key, g.total, (g as Counted).movements])).toEqual([
      ["food", cop(300_000), 1],
      ["housing", cop(110_000), 1],
    ]);
    expect(breakdown.account).toEqual({
      id: fund,
      in: cop(2_480_000),
      out: cop(410_000),
      movedToOwnAccounts: cop(0),
    });
  });

  it("answers 404 AccountNotFound for an account that is not the space's or hers, and 422 for a malformed id", async () => {
    const h = await household();
    const fund = await newAccount(h.ana, "Fondo de Hogar", 0, "SHARED_FUND");
    const marta = await registerUser("Marta");
    // Her Bancolombia is not Household's, and Household's fund is not one of her own accounts.
    expect(
      await problemOf(
        await getSpendingByGroup(h.ana, h.spaceId, { period: "2026-11", accountId: h.ana.account }),
      ),
    ).toEqual([404, "AccountNotFound"]);
    expect(
      await problemOf(
        await getPersonalSpendingByGroup(h.ana.personal, { period: "2026-11", accountId: fund }),
      ),
    ).toEqual([404, "AccountNotFound"]);
    // Juan's own account is not Ana's either.
    expect(
      await problemOf(
        await getPersonalSpendingByGroup(h.ana.personal, { period: "2026-11", accountId: h.juan.account }),
      ),
    ).toEqual([404, "AccountNotFound"]);
    // A stranger learns nothing about the fund: the space answers first.
    expect(
      await problemOf(await getSpendingByGroup(marta, h.spaceId, { period: "2026-11", accountId: fund })),
    ).toEqual([404, "SpaceNotFound"]);
    expect(
      await problemOf(
        await getSpendingByGroup(h.ana, h.spaceId, { period: "2026-11", accountId: "not-an-id" }),
      ),
    ).toEqual([422, "ValidationFailed"]);
  });
});
