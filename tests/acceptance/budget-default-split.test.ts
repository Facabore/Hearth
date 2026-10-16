import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp } from "../support/app";
import {
  activatePlan,
  getDefaultSplit,
  patchLine,
  putAllocation,
  putCategories,
  referencePlan,
} from "../support/budgeting";
import { categoryWithKey, cop } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/**
 * HU-E6-08 Background: the reference plan for 2026-11 in Household with Groceries mapped to Home (PROPORTIONAL,
 * Ana 40 % and Juan 60 %) and Free the catch-all line, NONE when `freeIsGroupMoney`; ACTIVE unless `draft`.
 * "Outings" is the seeded entertainment category, mapped to no line.
 */
const activeReference = async (options: { draft?: boolean; freeIsGroupMoney?: boolean } = {}) => {
  const ref = await referencePlan();
  const { h, planId, lineId } = ref;
  expect((await putCategories(h.ana, h.spaceId, planId, lineId("Home"), [h.groceries])).status).toBe(200);
  expect((await patchLine(h.ana, h.spaceId, planId, lineId("Free"), { isCatchAll: true })).status).toBe(200);
  if (options.freeIsGroupMoney) {
    expect((await putAllocation(h.ana, h.spaceId, planId, lineId("Free"), { rule: "NONE" })).status).toBe(
      200,
    );
  }
  if (!options.draft) expect((await activatePlan(h.ana, h.spaceId, planId)).status).toBe(200);
  return { ...ref, outings: await categoryWithKey(h.ana, "entertainment") };
};

describe("previewing the default split (HU-E6-08)", () => {
  it("defaults Groceries to BY_ALLOCATION by Home: 800,000 and 1,200,000 COP of 2,000,000 (golden)", async () => {
    const { h, lineId } = await activeReference();
    const response = await getDefaultSplit(h.juan, h.spaceId, {
      categoryId: h.groceries,
      date: "2026-11-08",
      amount: "200000000",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      method: "BY_ALLOCATION",
      availableMethods: ["BY_ALLOCATION", "EQUAL", "PERCENT", "EXACT", "SHARES"],
      lineId: lineId("Home"),
      shares: [
        { memberId: h.ana.memberId, amount: cop(800_000) },
        { memberId: h.juan.memberId, amount: cop(1_200_000) },
      ],
    });
  });

  it("gives the remainder of an amount that does not divide to the larger fraction, and the sub-unit to Ana", async () => {
    const { h } = await activeReference();
    // 1,000,001.50 COP over 588,000 / 882,000 COP: 400,000.4 and 600,000.6 pesos, so the leftover peso goes to Juan
    // (the larger fraction) and the 50 minor units below the rounding unit stay with the first member (spec 5.3).
    const response = await getDefaultSplit(h.ana, h.spaceId, {
      categoryId: h.groceries,
      date: "2026-11-08",
      amount: "100000150",
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { shares: unknown }).shares).toEqual([
      { memberId: h.ana.memberId, amount: { amount: "40000050", currency: "COP" } },
      { memberId: h.juan.memberId, amount: { amount: "60000100", currency: "COP" } },
    ]);
  });

  it("defaults an unmapped Outings expense to EQUAL through the NONE catch-all Free, without BY_ALLOCATION", async () => {
    const { h, lineId, outings } = await activeReference({ freeIsGroupMoney: true });
    const response = await getDefaultSplit(h.ana, h.spaceId, {
      categoryId: outings,
      date: "2026-11-12",
      amount: "5000000",
    });
    expect(await response.json()).toEqual({
      method: "EQUAL",
      availableMethods: ["EQUAL", "PERCENT", "EXACT", "SHARES"],
      lineId: lineId("Free"),
      shares: [
        { memberId: h.ana.memberId, amount: cop(25_000) },
        { memberId: h.juan.memberId, amount: cop(25_000) },
      ],
    });
  });

  it("defaults to EQUAL while the plan is a DRAFT, and previews no shares without an amount", async () => {
    const { h } = await activeReference({ draft: true });
    const response = await getDefaultSplit(h.ana, h.spaceId, { categoryId: h.groceries, date: "2026-11-08" });
    expect(await response.json()).toMatchObject({ method: "EQUAL", lineId: null, shares: null });
  });

  it("refuses any id that is not a category of the space: another space's, an unknown and a malformed one", async () => {
    const { h } = await activeReference({ draft: true });
    const personal = await categoryWithKey(h.ana.personal, "groceries");
    for (const categoryId of [personal, "7f2b9a54-6c1e-4d3a-8b0f-2e5c9d1a4f63", "not-a-category"]) {
      expect(
        await problemOf(await getDefaultSplit(h.ana, h.spaceId, { categoryId, date: "2026-11-08" })),
      ).toEqual([422, "CategoryNotInSpace"]);
    }
  });

  it("refuses a request without categoryId or date, and a malformed or out-of-range date", async () => {
    const { h } = await activeReference({ draft: true });
    // The helper types both as required; a client that leaves one out is what is under test.
    const ask = (query: { categoryId?: string; date?: string }) =>
      getDefaultSplit(h.ana, h.spaceId, query as Parameters<typeof getDefaultSplit>[2]);
    for (const query of [
      { date: "2026-11-08" },
      { categoryId: h.groceries },
      { categoryId: h.groceries, date: "not-a-date" },
      { categoryId: h.groceries, date: "2026-02-30" },
    ]) {
      expect(await problemOf(await ask(query))).toEqual([422, "ValidationFailed"]);
    }
    expect(await problemOf(await ask({ categoryId: h.groceries, date: "1899-12-31" }))).toEqual([
      422,
      "InvalidDate",
    ]);
  });

  it("accepts only a positive amount in minor units, digits only, within the supported range", async () => {
    const { h } = await activeReference({ draft: true });
    const ask = (amount: string) =>
      getDefaultSplit(h.ana, h.spaceId, { categoryId: h.groceries, date: "2026-11-08", amount });
    // 10^18 is the first value over the 18-digit cap; the other two are beyond int64.
    const overTheCap = ["1000000000000000000", "9223372036854775808", "99999999999999999999"];
    for (const amount of ["0", "-1", "1.5", "abc", "", " 100", "1e3", ...overTheCap]) {
      expect(await problemOf(await ask(amount)), `amount "${amount}"`).toEqual([422, "ValidationFailed"]);
    }
    // The largest accepted amount: 18 nines.
    const largest = await ask("999999999999999999");
    expect(largest.status).toBe(200);
    const { shares } = (await largest.json()) as { shares: { amount: { amount: string } }[] };
    expect(shares.reduce((sum, s) => sum + BigInt(s.amount.amount), 0n)).toBe(999_999_999_999_999_999n);
  });

  it("hides the space from non-members and from a malformed space id", async () => {
    const { h } = await activeReference({ draft: true });
    const marta = await registerUser("Marta");
    const query = { categoryId: h.groceries, date: "2026-11-08" };
    expect(await problemOf(await getDefaultSplit(marta, h.spaceId, query))).toEqual([404, "SpaceNotFound"]);
    expect(await problemOf(await getDefaultSplit(h.ana, "not-a-space", query))).toEqual([
      404,
      "SpaceNotFound",
    ]);
  });

  it("previews in an archived space too, which only reads (HU-E1-09)", async () => {
    const { h } = await activeReference({ draft: true });
    const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${h.spaceId}/archive`, {
      user: h.ana,
      params: { spaceId: h.spaceId },
    });
    expect(archived.status).toBe(204);
    const response = await getDefaultSplit(h.juan, h.spaceId, {
      categoryId: h.groceries,
      date: "2026-11-08",
    });
    expect(response.status).toBe(200);
  });
});
