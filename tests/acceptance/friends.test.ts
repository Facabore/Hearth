import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as directSplit } from "@/app/api/v1/direct-splits/route";
import { PATCH as setNickname } from "@/app/api/v1/me/friends/[spaceId]/route";
import { PATCH as updateMe } from "@/app/api/v1/me/route";
import { GET as listFriends } from "@/app/api/v1/me/friends/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, startTestApp, type TestUser } from "../support/app";
import { cop, household, type Household, type MoneyDto } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface FriendDto {
  spaceId: string;
  me: { memberId: string };
  other: {
    memberId: string;
    kind: "USER" | "GUEST";
    displayName: string;
    nickname: string | null;
    handle?: string;
    userId?: string;
  };
  name: string;
  net: MoneyDto;
  lastMovement: { transactionId: string; date: string; description: string; type: string } | null;
}

type Counterpart = { kind: "MEMBER"; memberId: string } | { kind: "GUEST"; displayName: string };

/** A direct split of `pesos` in "restaurants" recorded by Ana: paid by her from her account, or by the other one. */
const split = async (
  h: Household,
  counterpart: Counterpart,
  paidBy: "ME" | "COUNTERPART",
  description: string,
  date: string,
  pesos: number,
): Promise<{ spaceId: string; expense: { id: string } }> => {
  const response = await call(directSplit, "POST", "/api/v1/direct-splits", {
    user: h.ana,
    body: {
      counterpart,
      description,
      date,
      categoryKey: "restaurants",
      amount: cop(pesos),
      ...(paidBy === "ME" ? { accountId: h.ana.account } : { paidBy: "COUNTERPART" }),
    },
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { spaceId: string; expense: { id: string } };
};

const friendsOf = async (user: TestUser): Promise<FriendDto[]> => {
  const response = await call(listFriends, "GET", "/api/v1/me/friends", { user });
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: FriendDto[] }).items;
};

const nickname = (user: TestUser, spaceId: string, value: string | null) =>
  call(setNickname, "PATCH", `/api/v1/me/friends/${spaceId}`, {
    user,
    params: { spaceId },
    body: { nickname: value },
  });

const memberNamesIn = async (user: TestUser, spaceId: string): Promise<string[]> => {
  const response = await call(listMembers, "GET", `/api/v1/spaces/${spaceId}/members`, {
    user,
    params: { spaceId },
  });
  return ((await response.json()) as { items: { displayName: string }[] }).items.map((m) => m.displayName);
};

/** Ana paid a 120,000 COP dinner with Juan (he owes her 60,000); the guest Pedro paid a 40,000 taxi (she owes him 20,000). */
const anaWithJuanAndPedro = async () => {
  const h = await household();
  const dinner = await split(
    h,
    { kind: "MEMBER", memberId: h.juan.memberId },
    "ME",
    "Cena",
    "2026-10-14",
    120_000,
  );
  const taxi = await split(
    h,
    { kind: "GUEST", displayName: "Pedro" },
    "COUNTERPART",
    "Taxi",
    "2026-10-20",
    40_000,
  );
  return { h, dinner, taxi };
};

describe("Amigos: one row per person a direct space is shared with (P338)", () => {
  it("lists Pedro then Juan, newest movement first, with each net from Ana's side; shared spaces stay out", async () => {
    const { h, dinner, taxi } = await anaWithJuanAndPedro();
    const friends = await friendsOf(h.ana);
    expect(friends.map((f) => f.spaceId)).toEqual([taxi.spaceId, dinner.spaceId]);
    expect(friends[0]).toMatchObject({
      other: { kind: "GUEST", displayName: "Pedro", nickname: null },
      name: "Pedro",
      net: cop(-20_000),
      lastMovement: {
        transactionId: taxi.expense.id,
        date: "2026-10-20",
        description: "Taxi",
        type: "EXPENSE",
      },
    });
    expect(friends[1]).toMatchObject({
      other: { kind: "USER", displayName: "Juan", nickname: null },
      name: "Juan",
      net: cop(60_000),
      lastMovement: {
        transactionId: dinner.expense.id,
        date: "2026-10-14",
        description: "Cena",
        type: "EXPENSE",
      },
    });
    expect(friends[1]!.me.memberId).not.toBe(friends[1]!.other.memberId);
    // Juan sees Ana, owing her what she is owed.
    expect(await friendsOf(h.juan)).toMatchObject([
      {
        spaceId: dinner.spaceId,
        other: { kind: "USER", displayName: "Ana" },
        name: "Ana",
        net: cop(-60_000),
      },
    ]);
  });

  it("an apodo for a registered person is Ana's alone: Juan's list and the members list keep the names", async () => {
    const { h, dinner } = await anaWithJuanAndPedro();
    const set = await nickname(h.ana, dinner.spaceId, "  Juancho  ");
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({
      spaceId: dinner.spaceId,
      other: { kind: "USER", displayName: "Juan", nickname: "Juancho" },
      name: "Juancho",
    });
    const juan = (await friendsOf(h.ana)).find((f) => f.spaceId === dinner.spaceId);
    expect(juan).toMatchObject({ other: { displayName: "Juan", nickname: "Juancho" }, name: "Juancho" });
    expect(await friendsOf(h.juan)).toMatchObject([
      { other: { displayName: "Ana", nickname: null }, name: "Ana" },
    ]);
    expect(await memberNamesIn(h.ana, dinner.spaceId)).toEqual(["Ana", "Juan"]);
    // null clears it.
    expect((await nickname(h.ana, dinner.spaceId, null)).status).toBe(200);
    expect((await friendsOf(h.ana)).find((f) => f.spaceId === dinner.spaceId)).toMatchObject({
      other: { nickname: null },
      name: "Juan",
    });
  });

  it("an apodo for a guest is the guest's name, in the members list too", async () => {
    const { h, taxi } = await anaWithJuanAndPedro();
    const set = await nickname(h.ana, taxi.spaceId, "Pedrito");
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({
      other: { kind: "GUEST", displayName: "Pedrito", nickname: null },
      name: "Pedrito",
    });
    expect((await friendsOf(h.ana)).find((f) => f.spaceId === taxi.spaceId)).toMatchObject({
      name: "Pedrito",
    });
    expect(await memberNamesIn(h.ana, taxi.spaceId)).toEqual(["Ana", "Pedrito"]);
  });

  it("refuses a space Juan is not in, a shared space, an empty apodo, no name for a guest and a guest named as Ana", async () => {
    const { h, dinner, taxi } = await anaWithJuanAndPedro();
    expect(await problemOf(await nickname(h.juan, taxi.spaceId, "Pedro"))).toEqual([404, "SpaceNotFound"]);
    expect(await problemOf(await nickname(h.ana, h.spaceId, "Casa"))).toEqual([409, "NotADirectSpace"]);
    expect(await problemOf(await nickname(h.ana, dinner.spaceId, "   "))).toEqual([422, "InvalidNickname"]);
    expect(await problemOf(await nickname(h.ana, dinner.spaceId, "x".repeat(41)))).toEqual([
      422,
      "InvalidNickname",
    ]);
    expect(await problemOf(await nickname(h.ana, taxi.spaceId, null))).toEqual([422, "InvalidNickname"]);
    expect(await problemOf(await nickname(h.ana, taxi.spaceId, "ana"))).toEqual([409, "MemberNameTaken"]);
    expect(await memberNamesIn(h.ana, taxi.spaceId)).toEqual(["Ana", "Pedro"]);
    expect((await friendsOf(h.ana)).map((f) => f.name)).toEqual(["Pedro", "Juan"]);
  });

  it("shows a registered friend's @usuario once they pick one, and none for a guest (P339)", async () => {
    const { h, dinner, taxi } = await anaWithJuanAndPedro();
    const before = await friendsOf(h.ana.personal);
    expect(before.find((f) => f.spaceId === dinner.spaceId)?.other.handle).toBeUndefined();
    const picked = await call(updateMe, "PATCH", "/api/v1/me", {
      user: h.juan.personal,
      body: { handle: "juanp" },
    });
    expect(picked.status).toBe(200);
    const after = await friendsOf(h.ana.personal);
    expect(after.find((f) => f.spaceId === dinner.spaceId)?.other.handle).toBe("juanp");
    expect(after.find((f) => f.spaceId === taxi.spaceId)?.other.handle).toBeUndefined();
  });

  it("names a registered friend's user, so a group she shares with Ana does not list her twice; none for a guest (#338)", async () => {
    const { h, dinner, taxi } = await anaWithJuanAndPedro();
    const friends = await friendsOf(h.ana);
    expect(friends.find((f) => f.spaceId === dinner.spaceId)?.other.userId).toBe(h.juan.userId);
    expect(friends.find((f) => f.spaceId === taxi.spaceId)?.other).not.toHaveProperty("userId");
  });
});
