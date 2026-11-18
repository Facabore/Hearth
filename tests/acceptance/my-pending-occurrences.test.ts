import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GET as getMyPending } from "@/app/api/v1/me/pending-occurrences/route";
import { setContainerForTests, type Container } from "@/composition/container";
import type { LocalDate } from "@/shared/kernel";
import { call, startTestApp, type TestUser } from "../support/app";
import { MovableClock } from "../support/in-memory-recurrences";
import { categoryWithKey, cop, memberIdOf } from "../support/ledger";
import { householdWithFund, trackedRecurrences, type OccurrenceDto } from "../support/recurrences";
import { actingIn, newSharedSpace } from "../support/spaces";

let app: Container;
const clock = new MovableClock("2026-10-28");
beforeAll(() => {
  app = startTestApp({ clock });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** The job handles every active recurrence of the database, so each test ends its own after it ran (D8). */
const recurrences = trackedRecurrences();
afterEach(async () => {
  await recurrences.endAll();
});

const myPendingOf = async (user: TestUser): Promise<(OccurrenceDto & { spaceId: string })[]> => {
  const response = await call(getMyPending, "GET", "/api/v1/me/pending-occurrences", { user });
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: (OccurrenceDto & { spaceId: string })[] }).items;
};

/** A CONFIRM expense of 180,000 COP paid by `memberId` from `account`, on `day` of each month from 2026-12-01. */
const confirmBill = (
  description: string,
  category: string,
  memberId: string,
  account: string,
  day: number,
) => ({
  description,
  amount: cop(180_000),
  template: { type: "EXPENSE", categoryId: category, payer: { memberId, accountId: account } },
  schedule: { kind: "MONTHLY", day },
  mode: "CONFIRM",
  startDate: "2026-12-01",
});

describe("GET /api/v1/me/pending-occurrences (#338)", () => {
  it("lists Ana's pending bills of her two shared spaces in one read, each with its space", async () => {
    const h = await householdWithFund();
    const cabin = await newSharedSpace(h.ana.personal, "Cabin");
    const anaInCabin = actingIn(h.ana.personal, cabin);
    await recurrences.define(
      h.ana,
      h.spaceId,
      confirmBill("Electricity", h.utilities, h.ana.memberId, h.ana.account, 10),
    );
    await recurrences.define(
      anaInCabin,
      cabin,
      confirmBill(
        "Internet",
        await categoryWithKey(anaInCabin, "utilities"),
        await memberIdOf(anaInCabin, cabin, "Ana"),
        h.ana.account,
        5,
      ),
    );
    await app.ledger.materializeDueOccurrences({ today: "2026-12-10" as LocalDate });

    const mine = await myPendingOf(h.ana);
    const bySpace = (spaceId: string) =>
      mine
        .filter((o) => o.spaceId === spaceId)
        .map((o) => [o.description, o.date, o.status, o.amount.amount]);
    expect(mine).toHaveLength(2);
    expect(bySpace(h.spaceId)).toEqual([["Electricity", "2026-12-10", "PENDING", "18000000"]]);
    expect(bySpace(cabin)).toEqual([["Internet", "2026-12-05", "PENDING", "18000000"]]);
    // Juan is a member of the household only: he reads its bill and nothing of Ana's cabin.
    expect((await myPendingOf(h.juan)).map((o) => [o.spaceId, o.description])).toEqual([
      [h.spaceId, "Electricity"],
    ]);
  });

  it("answers 401 without a session", async () => {
    const response = await call(getMyPending, "GET", "/api/v1/me/pending-occurrences");
    expect(response.status).toBe(401);
  });
});
