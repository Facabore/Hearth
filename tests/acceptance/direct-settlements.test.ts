import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as directSettlement } from "@/app/api/v1/direct-settlements/route";
import { POST as directSplit } from "@/app/api/v1/direct-splits/route";
import { GET as listSpaces } from "@/app/api/v1/spaces/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, startTestApp, type TestUser } from "../support/app";
import { balanceOf, balancesOf, cop, household, type Household } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface DirectSettlementDto {
  spaceId: string;
  created: boolean;
  settlement: {
    type: string;
    payerMemberId: string;
    receivingMemberId: string;
    sourceAccountId: string | null;
    destinationAccountId: string | null;
    amount: { amount: string; currency: string };
  };
}

/** P334: Ana moves `pesos` to (TO) or from (FROM) Juan through her own account, on 2026-10-14. */
const transfer = (h: Household, direction: "TO" | "FROM", pesos: number, accountId = h.ana.account) =>
  call(directSettlement, "POST", "/api/v1/direct-settlements", {
    user: h.ana,
    body: {
      counterpart: { kind: "MEMBER", memberId: h.juan.memberId },
      direction,
      description: "Para el arriendo",
      date: "2026-10-14",
      amount: cop(pesos),
      accountId,
    },
  });
const settled = async (response: Response): Promise<DirectSettlementDto> => {
  expect(response.status).toBe(201);
  return (await response.json()) as DirectSettlementDto;
};
const pairOf = async (user: TestUser, spaceId: string): Promise<[string, string]> => {
  const response = await call(listMembers, "GET", `/api/v1/spaces/${spaceId}/members`, {
    user,
    params: { spaceId },
  });
  return ((await response.json()) as { items: { id: string }[] }).items.map((m) => m.id) as [string, string];
};
const directSpacesOf = async (user: TestUser) => {
  const response = await call(listSpaces, "GET", "/api/v1/spaces", { user });
  const { items } = (await response.json()) as { items: { kind: string }[] };
  return items.filter((s) => s.kind === "DIRECT").length;
};

describe("a transfer to or from someone, inside their direct space (P334)", () => {
  it("A alguien: creates Ana & Juan, leaves Ana's account and makes Juan owe her 150,000 COP", async () => {
    const h = await household();
    const sent = await settled(await transfer(h, "TO", 150_000));
    expect(sent.created).toBe(true);
    const [ana, juan] = await pairOf(h.ana, sent.spaceId);
    expect(sent.settlement).toMatchObject({
      type: "SETTLEMENT",
      payerMemberId: ana,
      receivingMemberId: juan,
      sourceAccountId: h.ana.account,
      destinationAccountId: null,
      amount: cop(150_000),
    });
    expect(await balancesOf(h.ana, sent.spaceId)).toEqual([
      [ana, cop(150_000)],
      [juan, cop(-150_000)],
    ]);
    expect(await balanceOf(h.ana.personal, h.ana.account)).toEqual(cop(1_850_000));
    expect(await balanceOf(h.juan.personal, h.juan.account)).toEqual(cop(2_000_000));
  });

  it("De alguien: in the existing direct space, Juan pays back what he owed into Ana's account", async () => {
    const h = await household();
    const first = await settled(await transfer(h, "TO", 150_000));
    const back = await settled(await transfer(h, "FROM", 100_000));
    expect(back).toMatchObject({ spaceId: first.spaceId, created: false });
    const [ana, juan] = await pairOf(h.ana, back.spaceId);
    expect(back.settlement).toMatchObject({
      payerMemberId: juan,
      receivingMemberId: ana,
      sourceAccountId: null,
      destinationAccountId: h.ana.account,
    });
    expect(await balancesOf(h.ana, back.spaceId)).toEqual([
      [ana, cop(50_000)],
      [juan, cop(-50_000)],
    ]);
    expect(await balanceOf(h.ana.personal, h.ana.account)).toEqual(cop(1_950_000));
    expect(await directSpacesOf(h.ana)).toBe(1);
  });

  it("settles a debt of Ana's from an expense Juan paid, in the same space", async () => {
    const h = await household();
    // Juan paid a 200,000 COP dinner for both, recorded by Ana from her personal space (P333): she owes him 100,000.
    const dinner = await call(directSplit, "POST", "/api/v1/direct-splits", {
      user: h.ana,
      body: {
        counterpart: { kind: "MEMBER", memberId: h.juan.memberId },
        paidBy: "COUNTERPART",
        description: "Cena",
        date: "2026-10-14",
        categoryKey: "restaurants",
        amount: cop(200_000),
      },
    });
    expect(dinner.status).toBe(201);
    const paid = await settled(await transfer(h, "TO", 150_000));
    const [ana, juan] = await pairOf(h.ana, paid.spaceId);
    expect(await balancesOf(h.ana, paid.spaceId)).toEqual([
      [ana, cop(50_000)],
      [juan, cop(-50_000)],
    ]);
  });

  it("refuses an account that is not Ana's and stores nothing, no direct space either", async () => {
    const h = await household();
    expect(await problemOf(await transfer(h, "TO", 150_000, h.juan.account))).toEqual([
      422,
      "AccountNotOwned",
    ]);
    expect(await directSpacesOf(h.ana)).toBe(0);
    expect(await balanceOf(h.juan.personal, h.juan.account)).toEqual(cop(2_000_000));
  });
});
