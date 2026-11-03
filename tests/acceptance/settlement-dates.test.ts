import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordSettlement } from "@/app/api/v1/spaces/[spaceId]/settlements/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { FixedClock } from "@/shared/kernel";
import { problemOf, startTestApp } from "../support/app";
import { activatePlan, closePlan, newPlan } from "../support/budgeting";
import { balancesOf, cop, household, post, type Household, type TransactionDto } from "../support/ledger";

let app: Container;
beforeAll(() => {
  // Today is 2026-11-10 in Bogota (noon), never the wall clock (AGENTS.md); October has ended, so it can close.
  app = startTestApp({ clock: new FixedClock(new Date("2026-11-10T17:00:00Z")) });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** Household with October's plan activated and closed. */
const octoberClosed = async (): Promise<Household> => {
  const h = await household();
  const { id } = await newPlan(h.ana, h.spaceId, "2026-10");
  expect((await activatePlan(h.ana, h.spaceId, id)).status).toBe(200);
  expect((await closePlan(h.ana, h.spaceId, id)).status).toBe(200);
  return h;
};
const juanToAna = (h: Household, extra: Record<string, unknown> = {}) => ({
  amount: cop(100_000),
  payerMemberId: h.juan.memberId,
  receivingMemberId: h.ana.memberId,
  ...extra,
});
const noBalances = (h: Household) => [
  [h.ana.memberId, cop(0)],
  [h.juan.memberId, cop(0)],
];

describe("the date of a settlement (HU-E5-02, HU-E6-07, M2-B review)", () => {
  it("refuses a settlement dated in a closed period, and settles nothing", async () => {
    const h = await octoberClosed();
    const response = await post(
      recordSettlement,
      h.juan,
      "settlements",
      juanToAna(h, { date: "2026-10-30" }),
    );
    expect(await problemOf(response)).toEqual([409, "PeriodClosed"]);
    expect(await balancesOf(h.ana, h.spaceId)).toEqual(noBalances(h));
  });

  it("checks whose account is debited before the period", async () => {
    const h = await octoberClosed();
    const response = await post(
      recordSettlement,
      h.ana,
      "settlements",
      juanToAna(h, { date: "2026-10-30", sourceAccountId: h.juan.account }),
    );
    expect(await problemOf(response)).toEqual([422, "AccountNotOwned"]);
  });

  it("dates a settlement sent with no date today, in the open period", async () => {
    const h = await octoberClosed();
    const response = await post(recordSettlement, h.juan, "settlements", juanToAna(h));
    expect(response.status).toBe(201);
    expect(((await response.json()) as TransactionDto).date).toBe("2026-11-10");
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(-100_000)],
      [h.juan.memberId, cop(100_000)],
    ]);
  });
});
