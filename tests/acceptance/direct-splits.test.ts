import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as acceptClaim } from "@/app/api/v1/claims/[token]/accept/route";
import { POST as directSplit } from "@/app/api/v1/direct-splits/route";
import { DELETE as deleteCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/route";
import { POST as archiveCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/archive/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { DELETE as removeGuestMember } from "@/app/api/v1/spaces/[spaceId]/guests/[memberId]/route";
import { POST as leaveSpace } from "@/app/api/v1/spaces/[spaceId]/leave/route";
import { PATCH as changeRole } from "@/app/api/v1/spaces/[spaceId]/members/[memberId]/route";
import { POST as addGuestMember } from "@/app/api/v1/spaces/[spaceId]/guests/route";
import { POST as createInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { GET as getSpace } from "@/app/api/v1/spaces/[spaceId]/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import { GET as listSpaces } from "@/app/api/v1/spaces/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import {
  addGuest,
  balancesOf,
  categoryWithKey,
  cop,
  household,
  memberIdOf,
  newAccount,
  post,
  type TransactionDto,
} from "../support/ledger";
import { actingIn, claimLink, joinAs, newSharedSpace } from "../support/spaces";

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
/** The expenses dated in October 2026 of `spaceId`, as `user` lists them (the splits of these tests are dated 2026-10-14). */
const expensesOf = async (user: TestUser, spaceId: string): Promise<TransactionDto[]> => {
  const response = await call(
    listTransactions,
    "GET",
    `/api/v1/spaces/${spaceId}/transactions?period=2026-10`,
    {
      user,
      params: { spaceId },
    },
  );
  return ((await response.json()) as { items: TransactionDto[] }).items;
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

describe("direct splits that cannot happen (HU-E1-13, Review Focus 3)", () => {
  it("answers 404 MemberNotFound for someone Ana shares no space with and for unknown or malformed ids", async () => {
    const { ana, bancolombia } = await anaWithBancolombia();
    const marta = await registerUser("Marta");
    const martasSpace = await newSharedSpace(marta, "Marta's");
    const martaId = await memberIdOf(marta, martasSpace, "Marta");
    for (const memberId of [martaId, "0190a0b0-0000-7000-8000-000000000000", "not-a-uuid"]) {
      const response = await split(
        ana,
        splitBody(bancolombia, { kind: "MEMBER", memberId }, "Dinner", 120_000),
      );
      expect(await problemOf(response)).toEqual([404, "MemberNotFound"]);
    }
    expect(await directSpacesOf(ana)).toEqual([]);
  });

  it("refuses splitting with herself or with a guest of a shared space (422 InvalidDirectCounterpart)", async () => {
    const h = await household();
    const pedro = await addGuest(h, "Pedro");
    for (const memberId of [h.ana.memberId, pedro]) {
      const response = await split(
        h.ana,
        splitBody(h.ana.account, { kind: "MEMBER", memberId }, "Dinner", 120_000),
      );
      expect(await problemOf(response)).toEqual([422, "InvalidDirectCounterpart"]);
    }
    expect(await directSpacesOf(h.ana)).toEqual([]);
  });

  it("refuses a new guest named like Ana with 409 MemberNameTaken and creates no space", async () => {
    const { ana, bancolombia } = await anaWithBancolombia();
    const namesake: Counterpart = { kind: "GUEST", displayName: "ana" };
    expect(await problemOf(await split(ana, splitBody(bancolombia, namesake, "Dinner", 120_000)))).toEqual([
      409,
      "MemberNameTaken",
    ]);
    expect(await directSpacesOf(ana)).toEqual([]);
  });

  it("leaves no direct space behind when the expense is refused", async () => {
    const h = await household();
    const unknownCategory = splitBody(h.ana.account, pedroAsGuest, "Dinner", 120_000, {
      categoryKey: "no-such-key",
    });
    expect(await problemOf(await split(h.ana, unknownCategory))).toEqual([404, "CategoryNotFound"]);
    expect(await directSpacesOf(h.ana)).toEqual([]);
    const juansAccount = splitBody(h.juan.account, pedroAsGuest, "Dinner", 120_000);
    expect(await problemOf(await split(h.ana, juansAccount))).toEqual([422, "AccountNotOwned"]);
    expect(await directSpacesOf(h.ana)).toEqual([]);
  });

  it("refuses an archived category with 409 CategoryArchived and records nothing in the direct space", async () => {
    const { ana, bancolombia } = await anaWithBancolombia();
    const dinner = await splitOk(await split(ana, splitBody(bancolombia, pedroAsGuest, "Dinner", 120_000)));
    const groceries = await categoryWithKey(actingIn(ana, dinner.spaceId), "groceries");
    const archived = await call(
      archiveCategory,
      "POST",
      `/api/v1/spaces/${dinner.spaceId}/categories/${groceries}/archive`,
      { user: ana, params: { spaceId: dinner.spaceId, categoryId: groceries } },
    );
    expect(archived.status).toBe(200);
    const pickPedro: Counterpart = {
      kind: "MEMBER",
      memberId: (await membersOf(ana, dinner.spaceId))[1]!.id,
    };
    const market = splitBody(bancolombia, pickPedro, "Market", 50_000, { categoryKey: "groceries" });
    expect(await problemOf(await split(ana, market))).toEqual([409, "CategoryArchived"]);
    expect(await expensesOf(ana, dinner.spaceId)).toHaveLength(1);
    expect(await directSpacesOf(ana)).toHaveLength(1);
  });

  it("answers 404 CategoryNotFound for a category deleted logically, which stays stored, and records nothing", async () => {
    const { ana, bancolombia } = await anaWithBancolombia();
    const dinner = await splitOk(await split(ana, splitBody(bancolombia, pedroAsGuest, "Dinner", 120_000)));
    const groceries = await categoryWithKey(actingIn(ana, dinner.spaceId), "groceries");
    const deleted = await call(
      deleteCategory,
      "DELETE",
      `/api/v1/spaces/${dinner.spaceId}/categories/${groceries}`,
      { user: ana, params: { spaceId: dinner.spaceId, categoryId: groceries } },
    );
    expect(deleted.status).toBe(204);
    // D8: the delete is logical, so the 404 below is the key reader skipping a row that is still there.
    const { rows } = await app.pool.query("SELECT deleted_at FROM categories WHERE id = $1", [groceries]);
    expect(rows).toEqual([{ deleted_at: expect.any(Date) }]);
    const pickPedro: Counterpart = {
      kind: "MEMBER",
      memberId: (await membersOf(ana, dinner.spaceId))[1]!.id,
    };
    const market = splitBody(bancolombia, pickPedro, "Market", 50_000, { categoryKey: "groceries" });
    expect(await problemOf(await split(ana, market))).toEqual([404, "CategoryNotFound"]);
    expect(await expensesOf(ana, dinner.spaceId)).toHaveLength(1);
    expect(await directSpacesOf(ana)).toHaveLength(1);
  });

  it("replays a retried split with the same Idempotency-Key, creating one space and one expense", async () => {
    const { ana, bancolombia } = await anaWithBancolombia();
    const body = splitBody(bancolombia, pedroAsGuest, "Dinner", 120_000);
    const headers = { "idempotency-key": "split-dinner-1" };
    const first = await splitOk(await split(ana, body, headers));
    expect(await splitOk(await split(ana, body, headers))).toEqual(first);
    expect(await directSpacesOf(ana)).toHaveLength(1);
    expect((await expensesOf(ana, first.spaceId)).map((e) => e.id)).toEqual([first.expense.id]);
    expect((await balancesOf(ana, first.spaceId)).map(([, net]) => net)).toEqual([cop(60_000), cop(-60_000)]);
    const conflicting = await split(ana, { ...body, description: "Lunch" }, headers);
    expect(await problemOf(conflicting)).toEqual([409, "IdempotencyKeyConflict"]);
  });

  it("keeps the two members fixed: leaving, removing the guest or changing a role is refused (D16)", async () => {
    const h = await household();
    const withPedro = await splitOk(
      await split(h.ana, splitBody(h.ana.account, pedroAsGuest, "Dinner", 120_000)),
    );
    const pedroId = (await membersOf(h.ana, withPedro.spaceId))[1]!.id;
    const left = await call(leaveSpace, "POST", `/api/v1/spaces/${withPedro.spaceId}/leave`, {
      user: h.ana,
      params: { spaceId: withPedro.spaceId },
    });
    expect(await problemOf(left)).toEqual([409, "DirectSpaceMembersFixed"]);
    const removed = await call(
      removeGuestMember,
      "DELETE",
      `/api/v1/spaces/${withPedro.spaceId}/guests/${pedroId}`,
      {
        user: h.ana,
        params: { spaceId: withPedro.spaceId, memberId: pedroId },
      },
    );
    expect(await problemOf(removed)).toEqual([409, "DirectSpaceMembersFixed"]);
    const pickJuan: Counterpart = { kind: "MEMBER", memberId: h.juan.memberId };
    const withJuan = await splitOk(await split(h.ana, splitBody(h.ana.account, pickJuan, "Lunch", 90_000)));
    const juanThere = (await membersOf(h.ana, withJuan.spaceId))[1]!.id;
    const demoted = await call(
      changeRole,
      "PATCH",
      `/api/v1/spaces/${withJuan.spaceId}/members/${juanThere}`,
      {
        user: h.ana,
        params: { spaceId: withJuan.spaceId, memberId: juanThere },
        body: { role: "MEMBER" },
      },
    );
    expect(await problemOf(demoted)).toEqual([409, "DirectSpaceMembersFixed"]);
  });
});

describe("a claimed direct space is the pair's direct space (HU-E1-11, HU-E1-13, D16, Task 14b)", () => {
  it("reuses 'Ana & Pedro' after Pedro claims it, also when Ana picks him in another space they share", async () => {
    const { ana, bancolombia } = await anaWithBancolombia();
    const dinner = await splitOk(await split(ana, splitBody(bancolombia, pedroAsGuest, "Dinner", 120_000)));
    const guestId = (await membersOf(ana, dinner.spaceId))[1]!.id;
    const pedro = await registerUser("Pedro");
    const link = await claimLink(ana, dinner.spaceId, guestId);
    const claimed = await call(acceptClaim, "POST", `/api/v1/claims/${link.token}/accept`, {
      user: pedro,
      params: { token: link.token },
    });
    expect(await claimed.json()).toMatchObject({ id: dinner.spaceId, role: "OWNER" });
    // Ana and Pedro also share "Trip"; picking Pedro there finds their direct space through its pair key.
    const trip = await newSharedSpace(ana, "Trip");
    await joinAs(ana, trip, pedro, "MEMBER");
    const pickPedro: Counterpart = { kind: "MEMBER", memberId: await memberIdOf(ana, trip, "Pedro") };
    const taxi = await splitOk(await split(ana, splitBody(bancolombia, pickPedro, "Taxi", 40_000)));
    expect(taxi).toMatchObject({ spaceId: dinner.spaceId, created: false });
    expect(await directSpacesOf(ana)).toHaveLength(1);
  });
});
