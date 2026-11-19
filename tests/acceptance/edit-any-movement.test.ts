import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordContribution } from "@/app/api/v1/spaces/[spaceId]/fund-contributions/route";
import { GET as transactionAudit } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/audit/route";
import {
  GET as getTransaction,
  PATCH as editTransaction,
} from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, startTestApp, type TestUser } from "../support/app";
import {
  addGuest,
  balanceOf,
  balancesOf,
  cop,
  household,
  joinHousehold,
  newAccount,
  post,
  settles,
  type Household,
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

interface AuditDto {
  readonly action: string;
  readonly actorUserId: string;
  readonly actorName?: string | null;
  readonly changes: Record<string, { from: string | null; to: string | null }>;
}

const pathOf = (h: Household, id: string) => `/api/v1/spaces/${h.spaceId}/transactions/${id}`;
const editAs = (h: Household, user: TestUser, id: string, body: unknown) =>
  call(editTransaction, "PATCH", pathOf(h, id), {
    user,
    params: { spaceId: h.spaceId, transactionId: id },
    body,
  });
const read = async (h: Household, user: TestUser, id: string): Promise<TransactionDto> =>
  (await (
    await call(getTransaction, "GET", pathOf(h, id), {
      user,
      params: { spaceId: h.spaceId, transactionId: id },
    })
  ).json()) as TransactionDto;
const auditOf = async (h: Household, user: TestUser, id: string): Promise<AuditDto[]> =>
  (
    (await (
      await call(transactionAudit, "GET", `${pathOf(h, id)}/audit`, {
        user,
        params: { spaceId: h.spaceId, transactionId: id },
      })
    ).json()) as { items: AuditDto[] }
  ).items;

describe("P344: any member who records money corrects a settlement, with its history", () => {
  it("lets Ana attach her account to the settlement Juan recorded for her, and shows who did it", async () => {
    const h = await household();
    // The staging case: Juan records "Ana paid Juan 29,000" with no account on either side.
    const paid = await settles(h.juan, h.ana.memberId, h.juan.memberId, 29_000);
    const attached = await editAs(h, h.ana, paid.id, { sourceAccountId: h.ana.account });
    expect(attached.status).toBe(200);
    expect((await attached.json()) as TransactionDto).toMatchObject({
      payerMemberId: h.ana.memberId,
      sourceAccountId: h.ana.account,
      receivingMemberId: h.juan.memberId,
      destinationAccountId: null,
      version: 2,
    });
    expect(await balanceOf(h.ana.personal, h.ana.account)).toEqual(cop(1_971_000));
    expect(await auditOf(h, h.juan, paid.id)).toEqual([
      expect.objectContaining({
        action: "UPDATED",
        actorUserId: h.ana.userId,
        actorName: "Ana",
        changes: { sourceAccountId: { from: null, to: h.ana.account } },
      }),
    ]);
  });

  it("refuses an account on a side that is not the editor's, and a viewer, and changes nothing", async () => {
    const h = await household();
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    const paid = await settles(h.juan, h.ana.memberId, h.juan.memberId, 29_000);
    expect(await problemOf(await editAs(h, h.juan, paid.id, { sourceAccountId: h.juan.account }))).toEqual([
      422,
      "AccountNotOwned",
    ]);
    expect(
      await problemOf(await editAs(h, h.ana, paid.id, { destinationAccountId: h.juan.account })),
    ).toEqual([422, "AccountNotOwned"]);
    expect(await problemOf(await editAs(h, sofi, paid.id, { description: "Mine" }))).toEqual([
      403,
      "InsufficientRole",
    ]);
    expect(await read(h, h.ana, paid.id)).toMatchObject({
      sourceAccountId: null,
      destinationAccountId: null,
    });
    expect(await auditOf(h, h.ana, paid.id)).toEqual([]);
  });

  it("lets a MEMBER who is not a party move the receiver to another member; balances follow", async () => {
    const h = await household();
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    const pedro = await addGuest(h, "Pedro");
    const paid = await settles(h.juan, h.ana.memberId, h.juan.memberId, 29_000);
    await editAs(h, h.juan, paid.id, { destinationAccountId: h.juan.account });
    expect(await balanceOf(h.juan.personal, h.juan.account)).toEqual(cop(2_029_000));
    const moved = await editAs(h, luis, paid.id, { receivingMemberId: pedro });
    expect(moved.status).toBe(200);
    expect((await moved.json()) as TransactionDto).toMatchObject({
      receivingMemberId: pedro,
      destinationAccountId: null,
    });
    // Juan's account no longer receives it, and the money now settles between Ana and Pedro.
    expect(await balanceOf(h.juan.personal, h.juan.account)).toEqual(cop(2_000_000));
    expect(new Map(await balancesOf(h.ana, h.spaceId))).toEqual(
      new Map([
        [h.ana.memberId, cop(29_000)],
        [h.juan.memberId, cop(0)],
        [luis.memberId, cop(0)],
        [pedro, cop(-29_000)],
      ]),
    );
    const [, entry] = await auditOf(h, h.ana, paid.id);
    expect([entry!.actorUserId, entry!.actorName, entry!.changes]).toEqual([
      luis.userId,
      "Luis",
      {
        receivingMemberId: { from: h.juan.memberId, to: pedro },
        destinationAccountId: { from: h.juan.account, to: null },
      },
    ]);
    expect(await problemOf(await editAs(h, luis, paid.id, { payerMemberId: pedro }))).toEqual([
      422,
      "InvalidSettlementParties",
    ]);
  });
});

describe("P344: a fund contribution's payer", () => {
  it("moves Juan's contribution to Ana, who names her own account; Juan's account gets its money back", async () => {
    const h = await household();
    const fund = await newAccount(h.ana, "Household Fund", 0, "SHARED_FUND");
    const recorded = await post(recordContribution, h.juan, "fund-contributions", {
      date: "2026-10-02",
      amount: cop(100_000),
      fundAccountId: fund,
      sourceAccountId: h.juan.account,
    });
    expect(recorded.status).toBe(201);
    const contribution = (await recorded.json()) as TransactionDto;
    const moved = await editAs(h, h.ana, contribution.id, {
      payerMemberId: h.ana.memberId,
      sourceAccountId: h.ana.account,
    });
    expect(moved.status).toBe(200);
    expect((await moved.json()) as TransactionDto).toMatchObject({
      payerMemberId: h.ana.memberId,
      sourceAccountId: h.ana.account,
      destinationAccountId: fund,
    });
    expect(await balanceOf(h.juan.personal, h.juan.account)).toEqual(cop(2_000_000));
    expect(await balanceOf(h.ana.personal, h.ana.account)).toEqual(cop(1_900_000));
    expect(await balanceOf(h.ana, fund)).toEqual(cop(100_000));
    expect((await auditOf(h, h.juan, contribution.id))[0]).toMatchObject({
      actorUserId: h.ana.userId,
      actorName: "Ana",
      changes: {
        payerMemberId: { from: h.juan.memberId, to: h.ana.memberId },
        sourceAccountId: { from: h.juan.account, to: h.ana.account },
      },
    });
    const fundMoved = await editAs(h, h.ana, contribution.id, { destinationAccountId: h.ana.account });
    expect(await fundMoved.json()).toMatchObject({ code: "FieldNotEditable", field: "destinationAccountId" });
  });
});
