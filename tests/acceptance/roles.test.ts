import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import { GET as listCategories } from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as addGuest } from "@/app/api/v1/spaces/[spaceId]/guests/route";
import { POST as createInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/route";
import { PATCH as changeRole } from "@/app/api/v1/spaces/[spaceId]/members/[memberId]/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { GET as getSpace } from "@/app/api/v1/spaces/[spaceId]/route";
import { PATCH as editTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { joinAs, newSharedSpace } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** HU-E1-05 Background: "Household" with OWNER Ana, ADMIN Juan, MEMBER Luis, VIEWER Sofi and the guest Pedro. */
interface Team {
  readonly spaceId: string;
  readonly ana: TestUser;
  readonly juan: TestUser;
  readonly luis: TestUser;
  readonly sofi: TestUser;
  readonly pedroId: string;
  readonly groceries: string;
  /** Personal BANK account per user id (D9: members pay shared expenses from their own accounts). */
  readonly accounts: ReadonlyMap<string, string>;
}

const cop = (pesos: number) => ({ amount: String(pesos * 100), currency: "COP" });
/** `[status, null]` for a success, `[status, code]` for a problem. */
const outcome = async (pending: Promise<Response>): Promise<[number, string | null]> => {
  const response = await pending;
  if (response.status >= 400) return problemOf(response);
  return [response.status, null];
};
const personalAccount = async (user: TestUser) => {
  const response = await call(createAccount, "POST", `/api/v1/spaces/${user.spaceId}/accounts`, {
    user,
    params: { spaceId: user.spaceId },
    body: { name: "Bancolombia", type: "BANK", openingBalance: cop(2_000_000) },
  });
  return ((await response.json()) as { id: string }).id;
};
const groceriesOf = async (user: TestUser, spaceId: string) => {
  const response = await call(listCategories, "GET", `/api/v1/spaces/${spaceId}/categories`, {
    user,
    params: { spaceId },
  });
  const { items } = (await response.json()) as {
    items: { categories: { id: string; key: string | null }[] }[];
  };
  return items.flatMap((g) => g.categories).find((c) => c.key === "groceries")!.id;
};
const team = async (): Promise<Team> => {
  const ana = await registerUser("Ana");
  const juan = await registerUser("Juan");
  const luis = await registerUser("Luis");
  const sofi = await registerUser("Sofi");
  const spaceId = await newSharedSpace(ana);
  await joinAs(ana, spaceId, juan, "ADMIN");
  await joinAs(ana, spaceId, luis, "MEMBER");
  await joinAs(ana, spaceId, sofi, "VIEWER");
  const pedro = await call(addGuest, "POST", `/api/v1/spaces/${spaceId}/guests`, {
    user: luis,
    params: { spaceId },
    body: { displayName: "Pedro" },
  });
  const accounts = new Map<string, string>();
  for (const user of [ana, luis, sofi]) accounts.set(user.userId, await personalAccount(user));
  return {
    spaceId,
    ana,
    juan,
    luis,
    sofi,
    pedroId: ((await pedro.json()) as { id: string }).id,
    groceries: await groceriesOf(ana, spaceId),
    accounts,
  };
};
const path = (t: Team, resource: string) => `/api/v1/spaces/${t.spaceId}/${resource}`;
const invite = (t: Team, user: TestUser) =>
  call(createInvitation, "POST", path(t, "invitations"), {
    user,
    params: { spaceId: t.spaceId },
    body: { kind: "LINK", role: "MEMBER" },
  });
const expense = (t: Team, user: TestUser) =>
  call(recordExpense, "POST", path(t, "expenses"), {
    user,
    params: { spaceId: t.spaceId },
    body: {
      description: "Market",
      amount: cop(85_000),
      categoryId: t.groceries,
      accountId: t.accounts.get(user.userId)!,
    },
  });
const edit = (t: Team, user: TestUser, transactionId: string) =>
  call(editTransaction, "PATCH", path(t, `transactions/${transactionId}`), {
    user,
    params: { spaceId: t.spaceId, transactionId },
    body: { description: "Market (edited)" },
  });
const transactions = (t: Team, user: TestUser) =>
  call(listTransactions, "GET", path(t, "transactions"), { user, params: { spaceId: t.spaceId } });
const guest = (t: Team, user: TestUser, displayName: string) =>
  call(addGuest, "POST", path(t, "guests"), { user, params: { spaceId: t.spaceId }, body: { displayName } });
const members = async (t: Team, user: TestUser) => {
  const response = await call(listMembers, "GET", path(t, "members"), {
    user,
    params: { spaceId: t.spaceId },
  });
  const { items } = (await response.json()) as {
    items: { id: string; displayName: string; role: string | null }[];
  };
  return items;
};
const memberIdOf = async (t: Team, name: string) =>
  (await members(t, t.ana)).find((m) => m.displayName === name)!.id;
const setRole = (t: Team, user: TestUser, memberId: string, role: string) =>
  call(changeRole, "PATCH", path(t, `members/${memberId}`), {
    user,
    params: { spaceId: t.spaceId, memberId },
    body: { role },
  });

describe("permissions per role (HU-E1-05)", () => {
  let t: Team;
  beforeAll(async () => {
    t = await team();
  });

  it("lets Juan (ADMIN) invite a member but not Luis (MEMBER)", async () => {
    expect(await outcome(invite(t, t.juan))).toEqual([201, null]);
    expect(await outcome(invite(t, t.luis))).toEqual([403, "InsufficientRole"]);
  });

  it("lets Luis (MEMBER) record an expense but not Sofi (VIEWER)", async () => {
    expect(await outcome(expense(t, t.luis))).toEqual([201, null]);
    expect(await outcome(expense(t, t.sofi))).toEqual([403, "InsufficientRole"]);
  });

  it("lets Juan (ADMIN) edit an expense created by Ana but not Luis (MEMBER)", async () => {
    const created = (await (await expense(t, t.ana)).json()) as { id: string };
    expect(await outcome(edit(t, t.luis, created.id))).toEqual([403, "InsufficientRole"]);
    expect(await outcome(edit(t, t.juan, created.id))).toEqual([200, null]);
  });

  it("lets Sofi (VIEWER) read the space's money records", async () => {
    // "view balances" arrives with HU-E5-01; reading the transactions exercises the same space.read action.
    expect(await outcome(transactions(t, t.sofi))).toEqual([200, null]);
  });

  it("lets Luis (MEMBER) add a guest but not Sofi (VIEWER)", async () => {
    expect(await outcome(guest(t, t.luis, "Marta"))).toEqual([201, null]);
    expect(await outcome(guest(t, t.sofi, "Lina"))).toEqual([403, "InsufficientRole"]);
  });

  it("answers 404 SpaceNotFound to Marta, who is neither a member nor a guest", async () => {
    const marta = await registerUser("Marta");
    expect(await outcome(transactions(t, marta))).toEqual([404, "SpaceNotFound"]);
  });

  it("answers 404 SpaceNotFound when a non-member adds a guest", async () => {
    const outsider = await registerUser("Outsider");
    expect(await outcome(guest(t, outsider, "Ghost"))).toEqual([404, "SpaceNotFound"]);
  });

  it("refuses role escalation, guest roles, unknown members and unknown roles (Review Focus 3, 5)", async () => {
    expect(await outcome(setRole(t, t.juan, await memberIdOf(t, "Juan"), "OWNER"))).toEqual([
      403,
      "InsufficientRole",
    ]);
    expect(await outcome(setRole(t, t.luis, await memberIdOf(t, "Sofi"), "ADMIN"))).toEqual([
      403,
      "InsufficientRole",
    ]);
    expect(await outcome(setRole(t, t.ana, t.pedroId, "MEMBER"))).toEqual([409, "GuestHasNoRole"]);
    expect(await outcome(setRole(t, t.ana, "not-a-uuid", "ADMIN"))).toEqual([404, "MemberNotFound"]);
    expect(await outcome(setRole(t, t.ana, await memberIdOf(t, "Luis"), "SUPERUSER"))).toEqual([
      422,
      "ValidationFailed",
    ]);
  });

  it("refuses to demote the only OWNER", async () => {
    expect(await outcome(setRole(t, t.ana, await memberIdOf(t, "Ana"), "ADMIN"))).toEqual([
      409,
      "LastOwnerRequired",
    ]);
  });
});

describe("owner changes a member's role (HU-E1-05)", () => {
  it("makes Luis an ADMIN, which Luis then sees in the space", async () => {
    const t = await team();
    const response = await setRole(t, t.ana, await memberIdOf(t, "Luis"), "ADMIN");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ displayName: "Luis", kind: "USER", role: "ADMIN" });
    const seen = await call(getSpace, "GET", `/api/v1/spaces/${t.spaceId}`, {
      user: t.luis,
      params: { spaceId: t.spaceId },
    });
    expect((await seen.json()).role).toBe("ADMIN");
  });

  it("lets an OWNER promote a MEMBER to OWNER and then step down, leaving exactly one OWNER", async () => {
    const t = await team();
    const promoted = await setRole(t, t.ana, await memberIdOf(t, "Luis"), "OWNER");
    expect(promoted.status).toBe(200);
    expect(await promoted.json()).toMatchObject({ displayName: "Luis", role: "OWNER" });
    const stepped = await setRole(t, t.ana, await memberIdOf(t, "Ana"), "ADMIN");
    expect(stepped.status).toBe(200);
    expect(await stepped.json()).toMatchObject({ displayName: "Ana", role: "ADMIN" });
    const owners = (await members(t, t.luis)).filter((m) => m.role === "OWNER");
    expect(owners.map((m) => m.displayName)).toEqual(["Luis"]);
  });
});
