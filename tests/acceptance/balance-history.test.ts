import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as leaveSpace } from "@/app/api/v1/spaces/[spaceId]/leave/route";
import { GET as historyRoute } from "@/app/api/v1/spaces/[spaceId]/members/[memberId]/balance-history/route";
import { DELETE as deleteTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import {
  addGuest,
  balancesOf,
  cop,
  household,
  joinHousehold,
  paysEqually,
  post,
  settles,
  type HouseholdMember,
  type MoneyDto,
  type TransactionDto,
} from "../support/ledger";
import { archiveHousehold } from "../support/recurrences";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface HistoryDto {
  memberId: string;
  from: string | null;
  to: string | null;
  opening: MoneyDto;
  closing: MoneyDto;
  entries: {
    transactionId: string;
    type: string;
    date: string;
    description: string;
    change: MoneyDto;
    balance: MoneyDto;
  }[];
}

/**
 * HU-E5-04 Background: Ana pays 300,000 COP split EQUAL on 2026-10-03, Juan pays 100,000 COP split EQUAL on
 * 2026-10-10, and Juan settles 100,000 COP to Ana on 2026-10-30.
 */
const movements = async () => {
  const h = await household();
  const pays = async (payer: HouseholdMember, pesos: number, date: string) => {
    const response = await post(recordExpense, payer, "expenses", {
      description: "Groceries",
      date,
      categoryId: h.groceries,
      amount: cop(pesos),
      payments: [{ memberId: payer.memberId, accountId: payer.account, amount: cop(pesos) }],
      split: { method: "EQUAL", participants: [{ memberId: h.ana.memberId }, { memberId: h.juan.memberId }] },
    });
    expect(response.status).toBe(201);
    return (await response.json()) as TransactionDto;
  };
  const anas = await pays(h.ana, 300_000, "2026-10-03");
  const juans = await pays(h.juan, 100_000, "2026-10-10");
  const settlement = await settles(h.juan, h.juan.memberId, h.ana.memberId, 100_000);
  return { h, anas, juans, settlement };
};
const historyPath = (spaceId: string, memberId: string, query = "") =>
  `/api/v1/spaces/${spaceId}/members/${memberId}/balance-history${query}`;
const historyOf = (user: TestUser, spaceId: string, memberId: string, query = "") =>
  call(historyRoute, "GET", historyPath(spaceId, memberId, query), { user, params: { spaceId, memberId } });
const read = async (response: Response) => {
  expect(response.status).toBe(200);
  return (await response.json()) as HistoryDto;
};
/** The problem document without its per-request id, so that two refusals can be compared byte for byte. */
const problemBody = async (response: Response) => {
  const { requestId, ...rest } = (await response.json()) as { requestId: string };
  expect(requestId).toEqual(expect.any(String));
  return rest;
};

describe("balance history (HU-E5-04)", () => {
  it("returns Juan's running net per movement: -150,000, -100,000 and 0 COP", async () => {
    const { h, anas, juans, settlement } = await movements();
    const history = await read(await historyOf(h.juan, h.spaceId, h.juan.memberId));
    expect(history.entries.map((e) => [e.transactionId, e.type, e.date, e.change, e.balance])).toEqual([
      [anas.id, "EXPENSE", "2026-10-03", cop(-150_000), cop(-150_000)],
      [juans.id, "EXPENSE", "2026-10-10", cop(50_000), cop(-100_000)],
      [settlement.id, "SETTLEMENT", "2026-10-30", cop(100_000), cop(0)],
    ]);
    expect([history.memberId, history.opening, history.closing, history.from, history.to]).toEqual([
      h.juan.memberId,
      cop(0),
      cop(0),
      null,
      null,
    ]);
    expect(history.entries.map((e) => e.description)).toEqual(["Groceries", "Groceries", ""]);
  });

  it("limits the history to 2026-10-01 … 2026-10-15: 2 entries and a closing net of -100,000 COP", async () => {
    const { h } = await movements();
    const history = await read(
      await historyOf(h.juan, h.spaceId, h.juan.memberId, "?from=2026-10-01&to=2026-10-15"),
    );
    expect([history.from, history.to]).toEqual(["2026-10-01", "2026-10-15"]);
    expect([history.entries.length, history.opening, history.closing]).toEqual([2, cop(0), cop(-100_000)]);
    const later = await read(await historyOf(h.juan, h.spaceId, h.juan.memberId, "?from=2026-10-11"));
    expect([later.opening, later.entries.map((e) => e.balance), later.closing]).toEqual([
      cop(-100_000),
      [cop(0)],
      cop(0),
    ]);
  });

  it("opens a span without movements at the net before it and closes it at the same net", async () => {
    const { h } = await movements();
    const quiet = await read(
      await historyOf(h.juan, h.spaceId, h.juan.memberId, "?from=2026-10-12&to=2026-10-20"),
    );
    expect([quiet.entries, quiet.opening, quiet.closing]).toEqual([[], cop(-100_000), cop(-100_000)]);
    const oneDay = await read(
      await historyOf(h.juan, h.spaceId, h.juan.memberId, "?from=2026-10-10&to=2026-10-10"),
    );
    expect([oneDay.entries.map((e) => e.balance), oneDay.opening, oneDay.closing]).toEqual([
      [cop(-100_000)],
      cop(-150_000),
      cop(-100_000),
    ]);
  });

  it("leaves out the soft-deleted 2026-10-10 expense: -150,000 then -50,000 COP, the balance Juan has now", async () => {
    const { h, juans } = await movements();
    const deleted = await call(
      deleteTransaction,
      "DELETE",
      `/api/v1/spaces/${h.spaceId}/transactions/${juans.id}`,
      {
        user: h.juan,
        params: { spaceId: h.spaceId, transactionId: juans.id },
      },
    );
    expect(deleted.status).toBe(204);
    const history = await read(await historyOf(h.juan, h.spaceId, h.juan.memberId));
    expect(history.entries.map((e) => e.balance)).toEqual([cop(-150_000), cop(-50_000)]);
    expect(history.entries.map((e) => e.transactionId)).not.toContain(juans.id);
    // The open-ended closing is the net the balances endpoint reports (HU-E5-01), for the payer of the deleted expense and for Ana.
    const anas = await read(await historyOf(h.ana, h.spaceId, h.ana.memberId));
    expect([history.closing, anas.closing]).toEqual([cop(-50_000), cop(50_000)]);
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, anas.closing],
      [h.juan.memberId, history.closing],
    ]);
  });

  it("is read by Sofi the VIEWER, for the guest Pedro too", async () => {
    const { h } = await movements();
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    const pedro = await addGuest(h, "Pedro");
    const lunch = await paysEqually(h.ana, 300_000, [h.ana.memberId, pedro], h.groceries);
    expect((await read(await historyOf(sofi, h.spaceId, h.ana.memberId))).closing).toEqual(cop(150_000));
    const guests = await read(await historyOf(sofi, h.spaceId, pedro));
    expect(guests.entries.map((e) => [e.transactionId, e.date, e.change, e.balance])).toEqual([
      [lunch.id, "2026-10-05", cop(-150_000), cop(-150_000)],
    ]);
    expect(guests.closing).toEqual(cop(-150_000));
    expect((await read(await historyOf(sofi, h.spaceId, sofi.memberId))).entries).toEqual([]);
  });

  it("is still read when the space is archived (HU-E1-09)", async () => {
    const { h, anas } = await movements();
    await archiveHousehold(h);
    const history = await read(await historyOf(h.juan, h.spaceId, h.ana.memberId));
    expect([history.entries[0]?.transactionId, history.entries.length, history.closing]).toEqual([
      anas.id,
      3,
      cop(0),
    ]);
  });

  it("answers the same 404 MemberNotFound, to the byte, for another space's member, a malformed or unknown id and a former member", async () => {
    const { h } = await movements();
    const other = await household();
    // Luis has a history: he paid 100,000 COP split with Ana, who paid him back 50,000 COP, and then he left.
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    await paysEqually(luis, 100_000, [h.ana.memberId, luis.memberId], h.groceries);
    await settles(h.ana, h.ana.memberId, luis.memberId, 50_000);
    expect((await read(await historyOf(h.ana, h.spaceId, luis.memberId))).closing).toEqual(cop(0));
    const left = await call(leaveSpace, "POST", `/api/v1/spaces/${h.spaceId}/leave`, {
      user: luis,
      params: { spaceId: h.spaceId },
    });
    expect(left.status).toBe(204);

    const refusals: unknown[] = [];
    for (const memberId of [other.juan.memberId, "not-a-uuid", randomUUID(), luis.memberId]) {
      const response = await historyOf(h.ana, h.spaceId, memberId);
      expect(response.status).toBe(404);
      refusals.push(await problemBody(response));
    }
    expect(refusals.map((refusal) => JSON.stringify(refusal))).toEqual(
      Array(4).fill(
        JSON.stringify({
          type: "urn:hearth:problem:MemberNotFound",
          title: "Not Found",
          status: 404,
          code: "MemberNotFound",
        }),
      ),
    );
  });

  it("refuses a non-member (404 SpaceNotFound) and a caller without a session (401)", async () => {
    const { h } = await movements();
    const marta = await registerUser("Marta");
    const refused = await historyOf(marta, h.spaceId, h.ana.memberId);
    expect(await problemBody(refused)).toEqual({
      type: "urn:hearth:problem:SpaceNotFound",
      title: "Not Found",
      status: 404,
      code: "SpaceNotFound",
    });
    const anonymous = await call(historyRoute, "GET", historyPath(h.spaceId, h.ana.memberId), {
      params: { spaceId: h.spaceId, memberId: h.ana.memberId },
    });
    expect(await problemOf(anonymous)).toEqual([401, "Unauthenticated"]);
  });

  it("refuses a range that runs backwards, naming the field (422 ValidationFailed)", async () => {
    const { h } = await movements();
    const reversed = await historyOf(h.ana, h.spaceId, h.ana.memberId, "?from=2026-10-15&to=2026-10-01");
    expect(reversed.status).toBe(422);
    expect(await problemBody(reversed)).toEqual({
      type: "urn:hearth:problem:ValidationFailed",
      title: "Unprocessable Content",
      status: 422,
      code: "ValidationFailed",
      errors: [{ path: "to", message: expect.stringContaining("from must not be after to") }],
    });
    // A single day is a range, and the dates may be given on their own.
    expect((await historyOf(h.ana, h.spaceId, h.ana.memberId, "?from=2026-10-10&to=2026-10-10")).status).toBe(
      200,
    );
    expect((await historyOf(h.ana, h.spaceId, h.ana.memberId, "?to=2026-10-01")).status).toBe(200);
  });

  it("refuses an impossible date (422 ValidationFailed) and one before 1900 (422 InvalidDate)", async () => {
    const { h } = await movements();
    const impossible = await historyOf(h.ana, h.spaceId, h.ana.memberId, "?to=2026-02-30");
    expect(impossible.status).toBe(422);
    expect(await problemBody(impossible)).toEqual({
      type: "urn:hearth:problem:ValidationFailed",
      title: "Unprocessable Content",
      status: 422,
      code: "ValidationFailed",
      errors: [{ path: "to", message: expect.any(String) }],
    });
    for (const query of ["?from=1899-12-31", "?to=1899-12-31"]) {
      const early = await historyOf(h.ana, h.spaceId, h.ana.memberId, query);
      expect(early.status).toBe(422);
      expect(await problemBody(early)).toEqual({
        type: "urn:hearth:problem:InvalidDate",
        title: "Unprocessable Content",
        status: 422,
        code: "InvalidDate",
      });
    }
  });
});
