import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as directSplit } from "@/app/api/v1/direct-splits/route";
import { PATCH as patchMe } from "@/app/api/v1/me/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import {
  GET as getTransaction,
  PATCH as editTransaction,
} from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { GET as listAudit } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/audit/route";
import { POST as recordFundContribution } from "@/app/api/v1/spaces/[spaceId]/fund-contributions/route";
import { POST as recordIncome } from "@/app/api/v1/spaces/[spaceId]/incomes/route";
import { POST as recordSettlement } from "@/app/api/v1/spaces/[spaceId]/settlements/route";
import { POST as recordTransfer } from "@/app/api/v1/spaces/[spaceId]/transfers/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { FixedClock } from "@/shared/kernel";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { categoryWithKey, cop, household, newAccount, post, type TransactionDto } from "../support/ledger";

let app: Container;
beforeAll(() => {
  // HU-E4-14 Background: the Clock reads 2026-10-17T03:30:00Z.
  app = startTestApp({ clock: new FixedClock(new Date("2026-10-17T03:30:00Z")) });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const setZone = (user: TestUser, timezone: string) =>
  call(patchMe, "PATCH", "/api/v1/me", { user, body: { timezone } });
/** Ana (Bogotá by APP_TIMEZONE) with "Bancolombia" in her personal space. */
const ana = async () => {
  const user = await registerUser("Ana");
  return {
    user,
    bank: await newAccount(user, "Bancolombia", 2_000_000),
    restaurants: await categoryWithKey(user, "restaurants"),
  };
};
type Ana = Awaited<ReturnType<typeof ana>>;
const expense = (a: Ana, extra: Record<string, unknown>) =>
  post(recordExpense, a.user, "expenses", {
    description: "Coffee",
    categoryId: a.restaurants,
    amount: cop(12_000),
    accountId: a.bank,
    ...extra,
  });
const timeOf = async (response: Response) => {
  expect(response.status).toBe(201);
  const tx = (await response.json()) as TransactionDto;
  return [tx.date, tx.occurredAt, tx.timeZone];
};

describe("recording the time of a transaction (HU-E4-14)", () => {
  it("records an expense with the time it happened (@critical)", async () => {
    const a = await ana();
    expect(await timeOf(await expense(a, { occurredAt: "2026-10-16T14:32:00-05:00" }))).toEqual([
      "2026-10-16",
      "2026-10-16T19:32:00.000Z",
      "America/Bogota",
    ]);
  });

  it("takes the moment of recording in each user's zone without a date or a time", async () => {
    const a = await ana();
    const juan = await ana();
    expect((await setZone(juan.user, "Europe/Madrid")).status).toBe(200);
    expect(await timeOf(await expense(a, {}))).toEqual([
      "2026-10-16",
      "2026-10-17T03:30:00.000Z",
      "America/Bogota",
    ]);
    expect(await timeOf(await expense(juan, {}))).toEqual([
      "2026-10-17",
      "2026-10-17T03:30:00.000Z",
      "Europe/Madrid",
    ]);
  });

  it("gives a date alone the time of day of now, and refuses a disagreeing pair, a null time or an unknown zone", async () => {
    const a = await ana();
    expect(await timeOf(await expense(a, { date: "2026-10-15" }))).toEqual([
      "2026-10-15",
      "2026-10-16T03:30:00.000Z",
      "America/Bogota",
    ]);
    // No body can ask for a date with no time: `untimed` is for system paths, and the body drops it.
    expect(await timeOf(await expense(a, { date: "2026-10-15", untimed: true }))).toEqual([
      "2026-10-15",
      "2026-10-16T03:30:00.000Z",
      "America/Bogota",
    ]);
    expect(
      await problemOf(await expense(a, { date: "2026-10-15", occurredAt: "2026-10-16T14:32:00-05:00" })),
    ).toEqual([422, "DateTimeMismatch"]);
    expect(await problemOf(await expense(a, { occurredAt: null }))).toEqual([422, "TimeRequired"]);
    expect(await problemOf(await expense(a, { timeZone: "Bogota" }))).toEqual([422, "InvalidTimeZone"]);
  });

  it("refuses an offset-form zone, and canonicalises an IANA alias (issue 126)", async () => {
    const a = await ana();
    for (const timeZone of ["+05:00", "-03:30"]) {
      expect(
        await problemOf(await expense(a, { occurredAt: "2026-10-16T14:32:00-05:00", timeZone })),
      ).toEqual([422, "InvalidTimeZone"]);
    }
    const aliased = await expense(a, { occurredAt: "2026-10-16T14:32:00-05:00", timeZone: "US/Pacific" });
    expect(aliased.status).toBe(201);
    expect((await timeOf(aliased))[2]).toBe("America/Los_Angeles");
  });

  it("takes a time on incomes, transfers, fund contributions and settlements", async () => {
    const a = await ana();
    const occurredAt = "2026-10-16T14:32:00-05:00";
    const salary = await categoryWithKey(a.user, "salary");
    const wallet = await newAccount(a.user, "Nequi", 0);
    const income = await post(recordIncome, a.user, "incomes", {
      categoryId: salary,
      amount: cop(100_000),
      accountId: a.bank,
      occurredAt,
    });
    // 20:30 in Bogotá is 03:30 the next day in Madrid: the date follows the zone that was sent.
    const transfer = await post(recordTransfer, a.user, "transfers", {
      amount: cop(50_000),
      sourceAccountId: a.bank,
      destinationAccountId: wallet,
      occurredAt: "2026-10-16T20:30:00-05:00",
      timeZone: "Europe/Madrid",
    });
    expect(await timeOf(income)).toEqual(["2026-10-16", "2026-10-16T19:32:00.000Z", "America/Bogota"]);
    expect(await timeOf(transfer)).toEqual(["2026-10-17", "2026-10-17T01:30:00.000Z", "Europe/Madrid"]);
    const h = await household();
    const fund = await newAccount(h.ana, "Household Fund", 0, "SHARED_FUND");
    const contribution = await post(recordFundContribution, h.ana, "fund-contributions", {
      amount: cop(100_000),
      fundAccountId: fund,
      sourceAccountId: h.ana.account,
      occurredAt,
    });
    const settlement = await post(recordSettlement, h.juan, "settlements", {
      amount: cop(10_000),
      payerMemberId: h.juan.memberId,
      receivingMemberId: h.ana.memberId,
      occurredAt,
    });
    expect(await timeOf(contribution)).toEqual(["2026-10-16", "2026-10-16T19:32:00.000Z", "America/Bogota"]);
    expect(await timeOf(settlement)).toEqual(["2026-10-16", "2026-10-16T19:32:00.000Z", "America/Bogota"]);
  });

  it("takes a time on a direct split", async () => {
    const a = await ana();
    const response = await call(directSplit, "POST", "/api/v1/direct-splits", {
      user: a.user,
      body: {
        counterpart: { kind: "GUEST", displayName: "Pedro" },
        categoryKey: "restaurants",
        amount: cop(12_000),
        accountId: a.bank,
        occurredAt: "2026-10-16T20:30:00-05:00",
        timeZone: "Europe/Madrid",
      },
    });
    expect(response.status).toBe(201);
    const { expense } = (await response.json()) as { expense: TransactionDto };
    expect([expense.date, expense.occurredAt, expense.timeZone]).toEqual([
      "2026-10-17",
      "2026-10-17T01:30:00.000Z",
      "Europe/Madrid",
    ]);
  });

  it("refuses an instant whose local date is outside the supported years, like a bad date (InvalidDate)", async () => {
    const a = await ana();
    expect(await problemOf(await expense(a, { occurredAt: "0026-10-16T14:32:00Z" }))).toEqual([
      422,
      "InvalidDate",
    ]);
    expect(await problemOf(await expense(a, { date: "0026-10-16" }))).toEqual([422, "InvalidDate"]);
  });
});

/** One valid request per create endpoint, to which a test adds its time fields. */
const creations: [string, (extra: Record<string, unknown>) => Promise<Response>][] = [
  ["expense", async (extra) => expense(await ana(), extra)],
  [
    "income",
    async (extra) => {
      const a = await ana();
      const body = {
        categoryId: await categoryWithKey(a.user, "salary"),
        amount: cop(100_000),
        accountId: a.bank,
      };
      return post(recordIncome, a.user, "incomes", { ...body, ...extra });
    },
  ],
  [
    "transfer",
    async (extra) => {
      const a = await ana();
      const body = {
        amount: cop(50_000),
        sourceAccountId: a.bank,
        destinationAccountId: await newAccount(a.user, "Nequi", 0),
      };
      return post(recordTransfer, a.user, "transfers", { ...body, ...extra });
    },
  ],
  [
    "fund contribution",
    async (extra) => {
      const h = await household();
      const fundAccountId = await newAccount(h.ana, "Household Fund", 0, "SHARED_FUND");
      const body = { amount: cop(100_000), fundAccountId, sourceAccountId: h.ana.account };
      return post(recordFundContribution, h.ana, "fund-contributions", { ...body, ...extra });
    },
  ],
  [
    "settlement",
    async (extra) => {
      const h = await household();
      const body = { amount: cop(10_000), payerMemberId: h.juan.memberId, receivingMemberId: h.ana.memberId };
      return post(recordSettlement, h.juan, "settlements", { ...body, ...extra });
    },
  ],
  [
    "direct split",
    async (extra) => {
      const a = await ana();
      const body = {
        counterpart: { kind: "GUEST", displayName: "Pedro" },
        categoryKey: "restaurants",
        amount: cop(12_000),
        accountId: a.bank,
      };
      return call(directSplit, "POST", "/api/v1/direct-splits", {
        user: a.user,
        body: { ...body, ...extra },
      });
    },
  ],
];

describe("a time that is removed or does not fit, on every create endpoint (HU-E4-14)", () => {
  it.each(creations)("refuses a null time on the %s endpoint (TimeRequired)", async (_, create) => {
    expect(await problemOf(await create({ date: "2026-10-16", occurredAt: null }))).toEqual([
      422,
      "TimeRequired",
    ]);
  });
});

const edit = (a: Ana, tx: TransactionDto, body: unknown, ifMatch?: string) =>
  call(editTransaction, "PATCH", `/api/v1/spaces/${a.user.spaceId}/transactions/${tx.id}`, {
    user: a.user,
    params: { spaceId: a.user.spaceId, transactionId: tx.id },
    body,
    headers: ifMatch === undefined ? undefined : { "if-match": ifMatch },
  });
const read = (a: Ana, tx: TransactionDto) =>
  call(getTransaction, "GET", `/api/v1/spaces/${a.user.spaceId}/transactions/${tx.id}`, {
    user: a.user,
    params: { spaceId: a.user.spaceId, transactionId: tx.id },
  });
const listing = (a: Ana, query: string) =>
  call(listTransactions, "GET", `/api/v1/spaces/${a.user.spaceId}/transactions?${query}`, {
    user: a.user,
    params: { spaceId: a.user.spaceId },
  });
const listed = async (a: Ana, query: string) => {
  const response = await listing(a, query);
  return {
    status: response.status,
    body: (await response.json()) as { items: TransactionDto[]; nextCursor: string | null },
  };
};
const recorded = async (response: Response) => (await response.json()) as TransactionDto;
/** A row as M3-C's scheduler or the M3-D migration leaves it; no person's request writes one (ruling P66). */
const withoutTime = async (tx: TransactionDto) => {
  await app.pool.query(`UPDATE transactions SET occurred_at = NULL, time_zone = NULL WHERE id = $1`, [tx.id]);
};

describe("lists and edits of timed transactions (HU-E4-14)", () => {
  it("lists newest day first, then newest time, untimed items last, page by page (Review Focus 2)", async () => {
    const a = await ana();
    for (const [description, extra] of [
      ["Taxi", { occurredAt: "2026-10-15T22:40:00-05:00" }],
      ["Market", { occurredAt: "2026-10-16T08:10:00-05:00" }],
      ["Rent", { date: "2026-10-16" }],
      ["Lunch", { occurredAt: "2026-10-16T13:05:00-05:00" }],
    ] as const) {
      const response = await expense(a, { description, ...extra });
      expect(response.status).toBe(201);
      // Rent stands for the AUTO occurrence of the scenario: recorded with its date and no time.
      if (description === "Rent") await withoutTime(await recorded(response));
    }
    const page = await listed(a, "period=2026-10");
    expect(page.body.items.map((t) => t.description)).toEqual(["Lunch", "Market", "Rent", "Taxi"]);
    expect(page.body.items[2]).toMatchObject({ occurredAt: null, timeZone: null });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const next = await listed(a, `period=2026-10&limit=1${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...next.body.items.map((t) => t.description));
      cursor = next.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual(["Lunch", "Market", "Rent", "Taxi"]);
  });

  it("answers InvalidCursor for a cursor from before M3-D", async () => {
    const a = await ana();
    const old = Buffer.from(JSON.stringify(["2026-10-16", "0199f3a2-7c1e-7a10-8b2c-1d2e3f405060"])).toString(
      "base64url",
    );
    expect(await problemOf(await listing(a, `period=2026-10&cursor=${old}`))).toEqual([422, "InvalidCursor"]);
  });

  it("keeps the local time when the date changes, audits it, never removes it, and times an old row", async () => {
    const a = await ana();
    const coffee = await recorded(await expense(a, { occurredAt: "2026-10-16T14:32:00-05:00" }));
    const moved = await edit(a, coffee, { date: "2026-10-14" });
    expect(moved.status).toBe(200);
    expect(await recorded(moved)).toMatchObject({
      date: "2026-10-14",
      occurredAt: "2026-10-14T19:32:00.000Z",
    });
    const audit = await call(
      listAudit,
      "GET",
      `/api/v1/spaces/${a.user.spaceId}/transactions/${coffee.id}/audit`,
      {
        user: a.user,
        params: { spaceId: a.user.spaceId, transactionId: coffee.id },
      },
    );
    const { items } = (await audit.json()) as { items: { changes: Record<string, unknown> }[] };
    expect(items[0]?.changes).toEqual({
      date: { from: "2026-10-16", to: "2026-10-14" },
      occurredAt: { from: "2026-10-16T19:32:00.000Z", to: "2026-10-14T19:32:00.000Z" },
    });
    expect(await problemOf(await edit(a, coffee, { occurredAt: null }))).toEqual([422, "TimeRequired"]);
    const read = await call(
      getTransaction,
      "GET",
      `/api/v1/spaces/${a.user.spaceId}/transactions/${coffee.id}`,
      {
        user: a.user,
        params: { spaceId: a.user.spaceId, transactionId: coffee.id },
      },
    );
    expect(await recorded(read)).toMatchObject({
      date: "2026-10-14",
      occurredAt: "2026-10-14T19:32:00.000Z",
    });
    expect(
      await problemOf(await edit(a, coffee, { date: "2026-10-15", occurredAt: "2026-10-16T14:32:00-05:00" })),
    ).toEqual([422, "DateTimeMismatch"]);
    const old = await recorded(await expense(a, { description: "Old market", date: "2026-09-20" }));
    await withoutTime(old);
    expect(await problemOf(await edit(a, old, { occurredAt: null }))).toEqual([422, "TimeRequired"]);
    const timed = await edit(a, old, { occurredAt: "2026-09-20T10:00:00-05:00" });
    expect(timed.status).toBe(200);
    expect(await recorded(timed)).toMatchObject({
      date: "2026-09-20",
      occurredAt: "2026-09-20T15:00:00.000Z",
      timeZone: "America/Bogota",
    });
  });

  it("re-zones a row when an edit sends a zone with its new instant, and refuses an unknown zone", async () => {
    const a = await ana();
    const dinner = await recorded(await expense(a, { occurredAt: "2026-10-16T14:32:00-05:00" }));
    // 20:30 in Bogotá is 03:30 the next day in Madrid: the date follows the zone that was sent.
    const rezoned = await edit(a, dinner, {
      occurredAt: "2026-10-16T20:30:00-05:00",
      timeZone: "Europe/Madrid",
    });
    expect(rezoned.status).toBe(200);
    expect(await recorded(rezoned)).toMatchObject({
      date: "2026-10-17",
      occurredAt: "2026-10-17T01:30:00.000Z",
      timeZone: "Europe/Madrid",
    });
    expect(
      await problemOf(await edit(a, dinner, { occurredAt: "2026-10-16T20:30:00-05:00", timeZone: "Bogota" })),
    ).toEqual([422, "InvalidTimeZone"]);
  });

  it("changes nothing when an edit sends a zone without an instant (P44)", async () => {
    const a = await ana();
    const tea = await recorded(await expense(a, { occurredAt: "2026-10-16T14:32:00-05:00" }));
    const same = await edit(a, tea, { timeZone: "Europe/Madrid" });
    expect(same.status).toBe(200);
    const unchanged = {
      date: "2026-10-16",
      occurredAt: "2026-10-16T19:32:00.000Z",
      timeZone: "America/Bogota",
    };
    expect(await recorded(same)).toMatchObject(unchanged);
    expect(await recorded(await read(a, tea))).toMatchObject(unchanged);
  });

  it("checks If-Match on a time edit: a stale ETag answers 412 and keeps the time, a fresh one answers 200 with the next ETag", async () => {
    const a = await ana();
    const tea = await recorded(await expense(a, { occurredAt: "2026-10-16T14:32:00-05:00" }));
    const fresh = await edit(a, tea, { occurredAt: "2026-10-16T15:10:00-05:00" }, '"1"');
    expect([fresh.status, fresh.headers.get("etag")]).toEqual([200, '"2"']);
    expect(await recorded(fresh)).toMatchObject({ occurredAt: "2026-10-16T20:10:00.000Z", version: 2 });
    const stale = await edit(a, tea, { occurredAt: "2026-10-16T18:00:00-05:00" }, '"1"');
    expect(await problemOf(stale)).toEqual([412, "PreconditionFailed"]);
    expect(await recorded(await read(a, tea))).toMatchObject({
      occurredAt: "2026-10-16T20:10:00.000Z",
      version: 2,
    });
  });

  it("counts by the local date, and a zone change moves nothing (HU-E1-14, Review Focus 1)", async () => {
    const a = await ana();
    const late = await recorded(
      await expense(a, { amount: cop(85_000), occurredAt: "2026-10-31T23:30:00-05:00" }),
    );
    expect(late).toMatchObject({ date: "2026-10-31", occurredAt: "2026-11-01T04:30:00.000Z" });
    expect((await listed(a, "period=2026-10")).body.items.map((t) => t.id)).toContain(late.id);
    expect((await setZone(a.user, "Europe/Madrid")).status).toBe(200);
    const after = (await listed(a, "period=2026-10")).body.items.find((t) => t.id === late.id);
    expect(after).toMatchObject({ date: "2026-10-31", timeZone: "America/Bogota" });
  });
});

describe("a clock change never moves a transaction off its date (issue 119, D19)", () => {
  const auditOf = async (a: Ana, tx: TransactionDto) => {
    const response = await call(
      listAudit,
      "GET",
      `/api/v1/spaces/${a.user.spaceId}/transactions/${tx.id}/audit`,
      { user: a.user, params: { spaceId: a.user.spaceId, transactionId: tx.id } },
    );
    return ((await response.json()) as { items: { changes: Record<string, unknown> }[] }).items;
  };

  it("keeps a move onto a day whose time of day is skipped at its end on that day, and accepts it again", async () => {
    const a = await ana();
    // 23:00 → 24:00 on 2026-03-28 in Nuuk: 23:30 does not exist that day.
    const late = await recorded(
      await expense(a, { occurredAt: "2026-03-27T23:30:00-02:00", timeZone: "America/Nuuk" }),
    );
    expect(late).toMatchObject({ date: "2026-03-27", occurredAt: "2026-03-28T01:30:00.000Z" });
    const moved = await edit(a, late, { date: "2026-03-28" });
    expect(moved.status).toBe(200);
    const resent = await recorded(moved);
    expect(resent).toMatchObject({ date: "2026-03-28", occurredAt: "2026-03-29T00:59:59.999Z" });
    // The instant it answers and the date it answers belong together: sending both back is no mismatch.
    const again = await edit(a, resent, { date: resent.date, occurredAt: resent.occurredAt });
    expect(again.status).toBe(200);
    expect(await recorded(again)).toMatchObject({
      date: "2026-03-28",
      occurredAt: "2026-03-29T00:59:59.999Z",
    });
  });

  it("keeps the second 02:30 of a repeated hour when a date alone resends the stored date, and audits nothing", async () => {
    const a = await ana();
    // 03:00 → 02:00 on 2026-10-25 in Madrid: 02:30 CET is the second 02:30 of that night.
    const second = await recorded(
      await expense(a, { occurredAt: "2026-10-25T02:30:00+01:00", timeZone: "Europe/Madrid" }),
    );
    expect(second).toMatchObject({ date: "2026-10-25", occurredAt: "2026-10-25T01:30:00.000Z" });
    const same = await edit(a, second, { date: "2026-10-25" });
    expect(same.status).toBe(200);
    expect(await recorded(same)).toMatchObject({
      date: "2026-10-25",
      occurredAt: "2026-10-25T01:30:00.000Z",
    });
    expect(await recorded(await read(a, second))).toMatchObject({ occurredAt: "2026-10-25T01:30:00.000Z" });
    expect(await auditOf(a, second)).toEqual([]);
  });
});
