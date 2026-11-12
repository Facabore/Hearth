import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as historyRoute } from "@/app/api/v1/spaces/[spaceId]/members/[memberId]/balance-history/route";
import { POST as recordSettlement } from "@/app/api/v1/spaces/[spaceId]/settlements/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import {
  DELETE as deleteTransaction,
  GET as getTransaction,
} from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { POST as restoreTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/restore/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, startTestApp, type TestUser } from "../support/app";
import {
  addGuest,
  balancesOf,
  cop,
  household,
  joinHousehold,
  paysEqually,
  post,
  type Household,
  type HouseholdMember,
  type MoneyDto,
  type TransactionDto,
} from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface P322Dto extends TransactionDto {
  settlementReason?: string;
  onBehalfOfMemberId?: string | null;
  linkedTransactionId?: string | null;
}

/** Ruling P322 Background: Ana paid 90,000 COP split EQUAL with Luis, so Luis owes Ana 45,000 COP; Juan owes nobody. */
const luisOwesAna = async (): Promise<Household & { luis: HouseholdMember }> => {
  const h = await household();
  const luis = await joinHousehold(h, "Luis", "MEMBER");
  await paysEqually(h.ana, 90_000, [h.ana.memberId, luis.memberId], h.groceries);
  return { ...h, luis };
};
const settle = (user: TestUser, body: Record<string, unknown>) =>
  post(recordSettlement, user, "settlements", { date: "2026-10-30", ...body });
const settled = async (response: Response): Promise<P322Dto> => {
  expect(response.status).toBe(201);
  return (await response.json()) as P322Dto;
};
/** Juan pays Ana the 45,000 COP Luis owes her. */
const juanPaysForLuis = (h: Household & { luis: HouseholdMember }, extra: Record<string, unknown> = {}) => ({
  amount: cop(45_000),
  payerMemberId: h.juan.memberId,
  receivingMemberId: h.ana.memberId,
  onBehalfOfMemberId: h.luis.memberId,
  ...extra,
});
const transactionPath = (spaceId: string, id: string) => `/api/v1/spaces/${spaceId}/transactions/${id}`;
const detailOf = async (user: TestUser, spaceId: string, id: string): Promise<P322Dto> => {
  const response = await call(getTransaction, "GET", transactionPath(spaceId, id), {
    user,
    params: { spaceId, transactionId: id },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as P322Dto;
};
const settlementIds = async (user: TestUser, spaceId: string) => {
  const response = await call(
    listTransactions,
    "GET",
    `/api/v1/spaces/${spaceId}/transactions?period=2026-10&type=SETTLEMENT`,
    { user, params: { spaceId } },
  );
  return ((await response.json()) as { items: P322Dto[] }).items.map((t) => t.id).sort();
};
interface HistoryEntry {
  transactionId: string;
  type: string;
  change: MoneyDto;
  balance: MoneyDto;
  settlementReason?: string;
  payerMemberId?: string;
  receivingMemberId?: string;
  onBehalfOfMemberId?: string | null;
  linkedTransactionId?: string | null;
}
const historyOf = async (user: TestUser, spaceId: string, memberId: string): Promise<HistoryEntry[]> => {
  const response = await call(
    historyRoute,
    "GET",
    `/api/v1/spaces/${spaceId}/members/${memberId}/balance-history`,
    { user, params: { spaceId, memberId } },
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { entries: HistoryEntry[] }).entries;
};

describe("paying someone else's debt and forgiving one (ruling P322)", () => {
  it("answers a plain settlement as before, now a PAYMENT for nobody", async () => {
    const h = await luisOwesAna();
    const tx = await settled(
      await settle(h.luis, {
        amount: cop(45_000),
        payerMemberId: h.luis.memberId,
        receivingMemberId: h.ana.memberId,
      }),
    );
    expect(tx).toMatchObject({
      type: "SETTLEMENT",
      payerMemberId: h.luis.memberId,
      receivingMemberId: h.ana.memberId,
      settlementReason: "PAYMENT",
      onBehalfOfMemberId: null,
      linkedTransactionId: null,
    });
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(0)],
      [h.luis.memberId, cop(0)],
    ]);
  });

  it("Me lo debe: Juan pays Ana for Luis, Ana is settled and Luis now owes Juan", async () => {
    const h = await luisOwesAna();
    const tx = await settled(await settle(h.juan, juanPaysForLuis(h)));
    expect(tx).toMatchObject({
      settlementReason: "PAYMENT",
      payerMemberId: h.juan.memberId,
      receivingMemberId: h.ana.memberId,
      onBehalfOfMemberId: h.luis.memberId,
      linkedTransactionId: null,
    });
    expect(await settlementIds(h.ana, h.spaceId)).toEqual([tx.id]);
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(45_000)],
      [h.luis.memberId, cop(-45_000)],
    ]);
  });

  it("Se lo regalo: two linked rows, Ana and Luis settled and nobody owes Juan", async () => {
    const h = await luisOwesAna();
    const payment = await settled(await settle(h.juan, juanPaysForLuis(h, { gift: true })));
    expect(payment).toMatchObject({ settlementReason: "PAYMENT", onBehalfOfMemberId: h.luis.memberId });
    const gift = await detailOf(h.ana, h.spaceId, payment.linkedTransactionId!);
    expect(gift).toMatchObject({
      type: "SETTLEMENT",
      settlementReason: "GIFT",
      payerMemberId: h.luis.memberId,
      receivingMemberId: h.juan.memberId,
      sourceAccountId: null,
      destinationAccountId: null,
      onBehalfOfMemberId: null,
      linkedTransactionId: payment.id,
      amount: cop(45_000),
      date: payment.date,
      occurredAt: payment.occurredAt,
      createdBy: h.juan.userId,
    });
    expect(await settlementIds(h.ana, h.spaceId)).toEqual([payment.id, gift.id].sort());
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(0)],
      [h.luis.memberId, cop(0)],
    ]);
  });

  it("refuses a gift whose payment is invalid and records neither half", async () => {
    const h = await luisOwesAna();
    // The payment's own check fails after the gift is decided on: Juan cannot debit Ana's account (D9).
    const response = await settle(h.juan, juanPaysForLuis(h, { gift: true, sourceAccountId: h.ana.account }));
    expect(await problemOf(response)).toEqual([422, "AccountNotOwned"]);
    expect(await settlementIds(h.ana, h.spaceId)).toEqual([]);
  });

  it("deletes and restores both halves of a gift from either one", async () => {
    const h = await luisOwesAna();
    for (const half of ["payment", "gift"] as const) {
      const payment = await settled(await settle(h.juan, juanPaysForLuis(h, { gift: true })));
      const giftId = payment.linkedTransactionId!;
      const id = half === "payment" ? payment.id : giftId;
      const params = { spaceId: h.spaceId, transactionId: id };
      const removed = await call(deleteTransaction, "DELETE", transactionPath(h.spaceId, id), {
        user: h.juan,
        params,
      });
      expect(removed.status).toBe(204);
      expect(await settlementIds(h.ana, h.spaceId)).toEqual([]);
      expect(await balancesOf(h.ana, h.spaceId)).toEqual([
        [h.ana.memberId, cop(45_000)],
        [h.juan.memberId, cop(0)],
        [h.luis.memberId, cop(-45_000)],
      ]);
      const restored = await call(restoreTransaction, "POST", `${transactionPath(h.spaceId, id)}/restore`, {
        user: h.juan,
        params,
      });
      expect(restored.status).toBe(200);
      expect(await settlementIds(h.ana, h.spaceId)).toEqual([payment.id, giftId].sort());
      expect(await balancesOf(h.ana, h.spaceId)).toEqual([
        [h.ana.memberId, cop(0)],
        [h.juan.memberId, cop(0)],
        [h.luis.memberId, cop(0)],
      ]);
      // Leaves the household as it was before this round.
      await call(deleteTransaction, "DELETE", transactionPath(h.spaceId, payment.id), {
        user: h.juan,
        params: { spaceId: h.spaceId, transactionId: payment.id },
      });
    }
  });

  it("Perdonar: Ana forgives Luis's debt, no money moves and both are settled", async () => {
    const h = await luisOwesAna();
    const tx = await settled(
      await settle(h.ana, {
        amount: cop(45_000),
        payerMemberId: h.luis.memberId,
        receivingMemberId: h.ana.memberId,
        reason: "FORGIVENESS",
      }),
    );
    expect(tx).toMatchObject({
      settlementReason: "FORGIVENESS",
      sourceAccountId: null,
      destinationAccountId: null,
      onBehalfOfMemberId: null,
      linkedTransactionId: null,
    });
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(0)],
      [h.luis.memberId, cop(0)],
    ]);
  });

  it("lets only the receiver forgive, or an OWNER or ADMIN for a guest receiver", async () => {
    const h = await luisOwesAna();
    const pedro = await addGuest(h, "Pedro");
    const luisForgiven = (to: string) => ({
      amount: cop(10_000),
      payerMemberId: h.luis.memberId,
      receivingMemberId: to,
      reason: "FORGIVENESS",
    });
    expect(await problemOf(await settle(h.luis, luisForgiven(h.ana.memberId)))).toEqual([
      403,
      "ForgivenessNotAllowed",
    ]);
    expect(await problemOf(await settle(h.juan, luisForgiven(h.ana.memberId)))).toEqual([
      403,
      "ForgivenessNotAllowed",
    ]);
    expect(await problemOf(await settle(h.juan, luisForgiven(pedro)))).toEqual([
      403,
      "ForgivenessNotAllowed",
    ]);
    expect(await settlementIds(h.ana, h.spaceId)).toEqual([]);
    expect((await settle(h.ana, luisForgiven(pedro))).status).toBe(201);
    const admin = await joinHousehold(h, "Sofi", "ADMIN");
    expect((await settle(admin, luisForgiven(pedro))).status).toBe(201);
  });

  it("answers each invalid request with its code and records nothing", async () => {
    const h = await luisOwesAna();
    const forgiveness = {
      amount: cop(45_000),
      payerMemberId: h.luis.memberId,
      receivingMemberId: h.ana.memberId,
      reason: "FORGIVENESS",
    };
    const cases: [Record<string, unknown>, string][] = [
      [juanPaysForLuis(h, { onBehalfOfMemberId: h.juan.memberId }), "InvalidOnBehalfOf"],
      [juanPaysForLuis(h, { onBehalfOfMemberId: h.ana.memberId }), "InvalidOnBehalfOf"],
      [
        juanPaysForLuis(h, { onBehalfOfMemberId: "0190b6a4-0000-7000-8000-000000000000" }),
        "InvalidOnBehalfOf",
      ],
      [juanPaysForLuis(h, { onBehalfOfMemberId: undefined, gift: true }), "GiftRequiresOnBehalfOf"],
    ];
    for (const [body, code] of cases) {
      expect(await problemOf(await settle(h.juan, body))).toEqual([422, code]);
    }
    const forgivenessCases: [Record<string, unknown>, string][] = [
      [{ ...forgiveness, destinationAccountId: h.ana.account }, "ForgivenessHasNoAccounts"],
      [{ ...forgiveness, onBehalfOfMemberId: h.juan.memberId }, "InvalidOnBehalfOf"],
      [{ ...forgiveness, gift: true }, "GiftRequiresOnBehalfOf"],
    ];
    for (const [body, code] of forgivenessCases) {
      expect(await problemOf(await settle(h.ana, body))).toEqual([422, code]);
    }
    expect(await settlementIds(h.ana, h.spaceId)).toEqual([]);
  });

  it("lists the payment in Luis's history with a change of 0, and says who paid whom for whom", async () => {
    const h = await luisOwesAna();
    const lent = await settled(await settle(h.juan, juanPaysForLuis(h, { amount: cop(20_000) })));
    const given = await settled(
      await settle(h.juan, juanPaysForLuis(h, { amount: cop(25_000), gift: true })),
    );
    const giftId = given.linkedTransactionId!;
    const luis = await historyOf(h.ana, h.spaceId, h.luis.memberId);
    expect(
      luis.map((e) => [
        e.transactionId,
        e.type,
        e.change,
        e.balance,
        e.settlementReason,
        e.payerMemberId,
        e.receivingMemberId,
        e.onBehalfOfMemberId,
      ]),
    ).toEqual([
      [expect.any(String), "EXPENSE", cop(-45_000), cop(-45_000), undefined, undefined, undefined, undefined],
      [
        lent.id,
        "SETTLEMENT",
        cop(0),
        cop(-45_000),
        "PAYMENT",
        h.juan.memberId,
        h.ana.memberId,
        h.luis.memberId,
      ],
      [
        given.id,
        "SETTLEMENT",
        cop(0),
        cop(-45_000),
        "PAYMENT",
        h.juan.memberId,
        h.ana.memberId,
        h.luis.memberId,
      ],
      [giftId, "SETTLEMENT", cop(25_000), cop(-20_000), "GIFT", h.luis.memberId, h.juan.memberId, null],
    ]);
    // The payment made for someone and its GIFT point at each other; every other entry is linked to nothing.
    expect(luis.map((e) => e.linkedTransactionId)).toEqual([undefined, null, giftId, given.id]);
    const juan = await historyOf(h.ana, h.spaceId, h.juan.memberId);
    expect(
      juan.map((e) => [
        e.transactionId,
        e.change,
        e.settlementReason,
        e.onBehalfOfMemberId,
        e.linkedTransactionId,
      ]),
    ).toEqual([
      [lent.id, cop(20_000), "PAYMENT", h.luis.memberId, null],
      [given.id, cop(25_000), "PAYMENT", h.luis.memberId, giftId],
      [giftId, cop(-25_000), "GIFT", null, given.id],
    ]);
  });
});
