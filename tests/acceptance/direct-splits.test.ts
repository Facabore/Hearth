import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as directSplit } from "@/app/api/v1/direct-splits/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as addGuestMember } from "@/app/api/v1/spaces/[spaceId]/guests/route";
import { POST as createInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { GET as getSpace } from "@/app/api/v1/spaces/[spaceId]/route";
import { GET as listSpaces } from "@/app/api/v1/spaces/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import {
  balancesOf,
  categoryWithKey,
  cop,
  household,
  newAccount,
  post,
  type TransactionDto,
} from "../support/ledger";
import { actingIn } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface DirectSplitDto {
  spaceId: string;
  created: boolean;
  expense: TransactionDto & { warnings: unknown[] };
}
interface MemberDto {
  id: string;
  kind: string;
  userId: string | null;
  displayName: string;
  role: string | null;
}
type Counterpart =
  { kind: "MEMBER"; memberId: string } | { kind: "GUEST"; displayName: string; contactEmail?: string };

/** A direct split paid in full from `accountId`, dated 2026-10-14, in the seeded category "restaurants". */
const splitBody = (
  accountId: string,
  counterpart: Counterpart,
  description: string,
  pesos: number,
  overrides: Record<string, unknown> = {},
) => ({
  counterpart,
  description,
  date: "2026-10-14",
  categoryKey: "restaurants",
  amount: cop(pesos),
  accountId,
  ...overrides,
});
const split = (user: TestUser, body: unknown, headers: Record<string, string> = {}) =>
  call(directSplit, "POST", "/api/v1/direct-splits", { user, body, headers });
const splitOk = async (response: Response): Promise<DirectSplitDto> => {
  expect(response.status).toBe(201);
  return (await response.json()) as DirectSplitDto;
};
const membersOf = async (user: TestUser, spaceId: string): Promise<MemberDto[]> => {
  const response = await call(listMembers, "GET", `/api/v1/spaces/${spaceId}/members`, {
    user,
    params: { spaceId },
  });
  return ((await response.json()) as { items: MemberDto[] }).items;
};
const directSpacesOf = async (user: TestUser) => {
  const response = await call(listSpaces, "GET", "/api/v1/spaces", { user });
  const { items } = (await response.json()) as { items: { id: string; kind: string }[] };
  return items.filter((s) => s.kind === "DIRECT");
};
/** HU-E1-13 Background: Ana is signed in with her account "Bancolombia". */
const anaWithBancolombia = async () => {
  const ana = await registerUser("Ana");
  return { ana, bancolombia: await newAccount(ana, "Bancolombia", 2_000_000) };
};
const pedroAsGuest: Counterpart = { kind: "GUEST", displayName: "Pedro" };

describe("split with one person through a direct space (HU-E1-13)", () => {
  it("creates 'Ana & Pedro' on the first split with the new guest Pedro, who owes Ana 60,000 COP (@critical)", async () => {
    const { ana, bancolombia } = await anaWithBancolombia();
    const dinner = await splitOk(await split(ana, splitBody(bancolombia, pedroAsGuest, "Dinner", 120_000)));
    expect(dinner.created).toBe(true);
    const space = await call(getSpace, "GET", `/api/v1/spaces/${dinner.spaceId}`, {
      user: ana,
      params: { spaceId: dinner.spaceId },
    });
    expect(await space.json()).toEqual({
      id: dinner.spaceId,
      name: "Ana & Pedro",
      kind: "DIRECT",
      currency: "COP",
      periodPolicy: { kind: "MONTHLY", day: 1 },
      role: "OWNER",
    });
    const members = await membersOf(ana, dinner.spaceId);
    expect(members.map((m) => [m.displayName, m.kind, m.role])).toEqual([
      ["Ana", "USER", "OWNER"],
      ["Pedro", "GUEST", null],
    ]);
    const [anaId, pedroId] = members.map((m) => m.id) as [string, string];
    expect(dinner.expense).toMatchObject({
      description: "Dinner",
      amount: cop(120_000),
      payments: [{ memberId: anaId, accountId: bancolombia, amount: cop(120_000) }],
      shares: [
        { memberId: anaId, amount: cop(60_000), splitMethod: "EQUAL" },
        { memberId: pedroId, amount: cop(60_000), splitMethod: "EQUAL" },
      ],
      warnings: [],
    });
    expect(await balancesOf(ana, dinner.spaceId)).toEqual([
      [anaId, cop(60_000)],
      [pedroId, cop(-60_000)],
    ]);
  });
});

describe("direct spaces are reused and keep their two members (HU-E1-13, D16)", () => {
  it("reuses 'Ana & Pedro' for a later 40,000 COP split with Pedro, who then owes Ana 80,000 COP", async () => {
    const { ana, bancolombia } = await anaWithBancolombia();
    const dinner = await splitOk(await split(ana, splitBody(bancolombia, pedroAsGuest, "Dinner", 120_000)));
    const pedroId = (await membersOf(ana, dinner.spaceId))[1]!.id;
    const pickPedro: Counterpart = { kind: "MEMBER", memberId: pedroId };
    const taxi = await splitOk(await split(ana, splitBody(bancolombia, pickPedro, "Taxi", 40_000)));
    expect(taxi).toMatchObject({ spaceId: dinner.spaceId, created: false });
    expect(await directSpacesOf(ana)).toHaveLength(1);
    expect((await balancesOf(ana, dinner.spaceId)).map(([, net]) => net)).toEqual([
      cop(80_000),
      cop(-80_000),
    ]);
  });

  it("creates 'Ana & Juan' with both registered as OWNER, and Juan's later split with Ana reuses it", async () => {
    const h = await household();
    const pickJuan: Counterpart = { kind: "MEMBER", memberId: h.juan.memberId };
    const lunch = await splitOk(await split(h.ana, splitBody(h.ana.account, pickJuan, "Lunch", 90_000)));
    expect(lunch.created).toBe(true);
    expect((await membersOf(h.ana, lunch.spaceId)).map((m) => [m.userId, m.kind, m.role])).toEqual([
      [h.ana.userId, "USER", "OWNER"],
      [h.juan.userId, "USER", "OWNER"],
    ]);
    const space = await call(getSpace, "GET", `/api/v1/spaces/${lunch.spaceId}`, {
      user: h.juan,
      params: { spaceId: lunch.spaceId },
    });
    expect(await space.json()).toMatchObject({ name: "Ana & Juan", kind: "DIRECT", role: "OWNER" });
    // Juan owes Ana 45,000 COP.
    expect((await balancesOf(h.juan, lunch.spaceId)).map(([, net]) => net)).toEqual([
      cop(45_000),
      cop(-45_000),
    ]);
    const pickAna: Counterpart = { kind: "MEMBER", memberId: h.ana.memberId };
    const coffee = await splitOk(await split(h.juan, splitBody(h.juan.account, pickAna, "Coffee", 20_000)));
    expect(coffee).toMatchObject({ spaceId: lunch.spaceId, created: false });
  });

  it("splits a later expense recorded without a split method EQUAL between Ana and Pedro", async () => {
    const { ana, bancolombia } = await anaWithBancolombia();
    const dinner = await splitOk(await split(ana, splitBody(bancolombia, pedroAsGuest, "Dinner", 120_000)));
    const inDirect = actingIn(ana, dinner.spaceId);
    const later = await post(recordExpense, inDirect, "expenses", {
      description: "Snacks",
      date: "2026-10-15",
      categoryId: await categoryWithKey(inDirect, "restaurants"),
      amount: cop(30_000),
      accountId: bancolombia,
    });
    expect(later.status).toBe(201);
    const [anaId, pedroId] = (await membersOf(ana, dinner.spaceId)).map((m) => m.id);
    expect(((await later.json()) as TransactionDto).shares).toEqual([
      { memberId: anaId, amount: cop(15_000), splitMethod: "EQUAL" },
      { memberId: pedroId, amount: cop(15_000), splitMethod: "EQUAL" },
    ]);
  });

  it("never lets 'Ana & Pedro' get a third member, as a guest or by invitation (D16)", async () => {
    const { ana, bancolombia } = await anaWithBancolombia();
    const { spaceId } = await splitOk(
      await split(ana, splitBody(bancolombia, pedroAsGuest, "Dinner", 120_000)),
    );
    const guest = await call(addGuestMember, "POST", `/api/v1/spaces/${spaceId}/guests`, {
      user: ana,
      params: { spaceId },
      body: { displayName: "Luis" },
    });
    expect(await problemOf(guest)).toEqual([409, "DirectSpaceIsFull"]);
    const invitation = await call(createInvitation, "POST", `/api/v1/spaces/${spaceId}/invitations`, {
      user: ana,
      params: { spaceId },
      body: { kind: "EMAIL", email: "juan@example.com", role: "MEMBER" },
    });
    expect(await problemOf(invitation)).toEqual([409, "DirectSpaceIsFull"]);
  });
});
