import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as directSplit } from "@/app/api/v1/direct-splits/route";
import { POST as acceptRequest } from "@/app/api/v1/me/friend-requests/[requestId]/accept/route";
import { POST as rejectRequest } from "@/app/api/v1/me/friend-requests/[requestId]/reject/route";
import { GET as listRequests, POST as sendRequest } from "@/app/api/v1/me/friend-requests/route";
import { DELETE as removeFriend } from "@/app/api/v1/me/friends/[spaceId]/route";
import { GET as listFriends, POST as addGuestFriend } from "@/app/api/v1/me/friends/route";
import { GET as getMe, PATCH as updateMe } from "@/app/api/v1/me/route";
import { GET as spaceBalances } from "@/app/api/v1/spaces/[spaceId]/balances/route";
import { GET as findByHandle } from "@/app/api/v1/users/by-handle/[handle]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { cop } from "../support/ledger";

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
  other: { memberId: string; kind: "USER" | "GUEST"; displayName: string; nickname: string | null };
  name: string;
  net: { amount: string; currency: string };
}

interface RequestDto {
  id: string;
  handle: string | null;
  displayName: string;
  createdAt: string;
}

/** A handle no other test (or file) uses: the prefix, an underscore and eight hex digits. */
const freshHandle = (prefix: string): string => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;

const setHandle = (user: TestUser, handle: string | null) =>
  call(updateMe, "PATCH", "/api/v1/me", { user, body: { handle } });

/** A registered person with a handle of their own. */
const person = async (name: string): Promise<TestUser & { handle: string }> => {
  const user = await registerUser(name);
  const handle = freshHandle(name.toLowerCase());
  const response = await setHandle(user, handle);
  expect(response.status).toBe(200);
  return { ...user, handle };
};

const lookup = (user: TestUser, handle: string) =>
  call(findByHandle, "GET", `/api/v1/users/by-handle/${encodeURIComponent(handle)}`, {
    user,
    params: { handle },
  });

const send = (user: TestUser, handle: string) =>
  call(sendRequest, "POST", "/api/v1/me/friend-requests", { user, body: { handle } });

const requestsOf = async (user: TestUser): Promise<{ incoming: RequestDto[]; outgoing: RequestDto[] }> => {
  const response = await call(listRequests, "GET", "/api/v1/me/friend-requests", { user });
  expect(response.status).toBe(200);
  return (await response.json()) as { incoming: RequestDto[]; outgoing: RequestDto[] };
};

const accept = (user: TestUser, requestId: string) =>
  call(acceptRequest, "POST", `/api/v1/me/friend-requests/${requestId}/accept`, {
    user,
    params: { requestId },
  });

const reject = (user: TestUser, requestId: string) =>
  call(rejectRequest, "POST", `/api/v1/me/friend-requests/${requestId}/reject`, {
    user,
    params: { requestId },
  });

const friendsOf = async (user: TestUser): Promise<FriendDto[]> => {
  const response = await call(listFriends, "GET", "/api/v1/me/friends", { user });
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: FriendDto[] }).items;
};

const remove = (user: TestUser, spaceId: string) =>
  call(removeFriend, "DELETE", `/api/v1/me/friends/${spaceId}`, { user, params: { spaceId } });

/** Ana and Bruno, friends through an accepted request. */
const friends = async () => {
  const ana = await person("Ana");
  const bruno = await person("Bruno");
  const sent = (await (await send(ana, bruno.handle)).json()) as RequestDto;
  const accepted = await accept(bruno, sent.id);
  expect(accepted.status).toBe(200);
  const { spaceId } = (await accepted.json()) as { spaceId: string };
  return { ana, bruno, spaceId };
};

describe("@usuario: a unique handle on the profile (P339, S2)", () => {
  it("sets, shows and changes the handle; upper case is stored in lower case", async () => {
    const ana = await registerUser("Ana");
    const handle = freshHandle("ana");
    const set = await setHandle(ana, `@${handle.toUpperCase()}`);
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({ handle });
    const me = await call(getMe, "GET", "/api/v1/me", { user: ana });
    expect(await me.json()).toMatchObject({ handle });
    const other = freshHandle("anita");
    expect(await (await setHandle(ana, other)).json()).toMatchObject({ handle: other });
    // The old handle is free again.
    expect(await problemOf(await lookup(await registerUser("Eva"), handle))).toEqual([404, "UserNotFound"]);
  });

  it("refuses to clear the handle with InvalidHandle, and keeps it (P343)", async () => {
    const ana = await person("Ana");
    expect(await problemOf(await setHandle(ana, null))).toEqual([422, "InvalidHandle"]);
    expect(await (await call(getMe, "GET", "/api/v1/me", { user: ana })).json()).toMatchObject({
      handle: ana.handle,
    });
  });

  it("gives a new person a handle made of their name, which others find (P343)", async () => {
    const jose = await registerUser("José Ñúñez", `jose-${randomUUID()}@example.com`);
    const me = (await (await call(getMe, "GET", "/api/v1/me", { user: jose })).json()) as { handle: string };
    expect(me.handle).toMatch(/^josenunez_[0-9]{4}$/);
    const found = await lookup(await registerUser("Eva"), me.handle);
    expect(await found.json()).toStrictEqual({ handle: me.handle, displayName: "José Ñúñez" });
  });

  it("refuses a handle someone else holds, whatever its case, and keeps the person's own", async () => {
    const ana = await person("Ana");
    const bruno = await person("Bruno");
    expect(await problemOf(await setHandle(bruno, ana.handle.toUpperCase()))).toEqual([409, "HandleTaken"]);
    // Setting her own handle again is no change.
    expect((await setHandle(ana, ana.handle)).status).toBe(200);
    expect(await (await call(getMe, "GET", "/api/v1/me", { user: bruno })).json()).toMatchObject({
      handle: bruno.handle,
    });
  });

  it("refuses handles that are too short, too long or carry other characters, and writes nothing", async () => {
    const ana = await person("Ana");
    for (const bad of ["ab", "a".repeat(21), "ana-maria", "ana maria", "añá_1", ""]) {
      expect(await problemOf(await setHandle(ana, bad))).toEqual([422, "InvalidHandle"]);
    }
    const both = await call(updateMe, "PATCH", "/api/v1/me", {
      user: ana,
      body: { handle: "x", timezone: "Europe/Madrid" },
    });
    expect(await problemOf(both)).toEqual([422, "InvalidHandle"]);
    expect(await (await call(getMe, "GET", "/api/v1/me", { user: ana })).json()).toMatchObject({
      handle: ana.handle,
      timezone: "America/Bogota",
    });
  });
});

describe("Lookup by the exact @ (P339, S3)", () => {
  it("answers only the handle and the display name, ignoring case and a leading @", async () => {
    const ana = await person("Ana");
    const bruno = await person("Bruno");
    const found = await lookup(ana, `@${bruno.handle.toUpperCase()}`);
    expect(found.status).toBe(200);
    expect(await found.json()).toStrictEqual({ handle: bruno.handle, displayName: "Bruno" });
  });

  it("is UserNotFound for a prefix, an unknown or malformed handle and the caller's own", async () => {
    const ana = await person("Ana");
    const bruno = await person("Bruno");
    for (const handle of [bruno.handle.slice(0, -1), freshHandle("nadie"), "no", "x!x", ana.handle]) {
      expect(await problemOf(await lookup(ana, handle))).toEqual([404, "UserNotFound"]);
    }
  });

  it("needs a session", async () => {
    const bruno = await person("Bruno");
    const response = await call(findByHandle, "GET", `/api/v1/users/by-handle/${bruno.handle}`, {
      params: { handle: bruno.handle },
    });
    expect(response.status).toBe(401);
  });
});

describe("Friend requests (P339, S4)", () => {
  it("a request accepted creates one direct space, and each sees the other in Amigos", async () => {
    const ana = await person("Ana");
    const bruno = await person("Bruno");
    const sent = await send(ana, bruno.handle);
    expect(sent.status).toBe(201);
    const request = (await sent.json()) as RequestDto & { status: string };
    expect(request).toMatchObject({ status: "PENDING", handle: bruno.handle, displayName: "Bruno" });

    expect(await requestsOf(ana)).toEqual({
      incoming: [],
      outgoing: [
        { id: request.id, handle: bruno.handle, displayName: "Bruno", createdAt: request.createdAt },
      ],
    });
    expect(await requestsOf(bruno)).toEqual({
      incoming: [{ id: request.id, handle: ana.handle, displayName: "Ana", createdAt: request.createdAt }],
      outgoing: [],
    });

    // A second request answers the pending one.
    const again = await send(ana, bruno.handle);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ id: request.id, status: "PENDING" });

    // Only Bruno answers it; for Ana it does not exist.
    expect(await problemOf(await accept(ana, request.id))).toEqual([404, "FriendRequestNotFound"]);
    const accepted = await accept(bruno, request.id);
    expect(accepted.status).toBe(200);
    const { spaceId } = (await accepted.json()) as { spaceId: string };

    expect(await friendsOf(bruno)).toMatchObject([
      { spaceId, other: { kind: "USER", displayName: "Ana" }, name: "Ana", net: cop(0) },
    ]);
    expect(await friendsOf(ana)).toMatchObject([{ spaceId, name: "Bruno", net: cop(0) }]);
    expect(await requestsOf(ana)).toEqual({ incoming: [], outgoing: [] });
    expect(await requestsOf(bruno)).toEqual({ incoming: [], outgoing: [] });
    // Answered once: a second accept finds nothing.
    expect(await problemOf(await accept(bruno, request.id))).toEqual([404, "FriendRequestNotFound"]);
  });

  it("sending to someone who already asked you accepts their request", async () => {
    const ana = await person("Ana");
    const bruno = await person("Bruno");
    const theirs = (await (await send(ana, bruno.handle)).json()) as RequestDto;
    const mine = await send(bruno, ana.handle);
    expect(mine.status).toBe(200);
    const outcome = (await mine.json()) as RequestDto & { status: string; spaceId: string };
    expect(outcome).toMatchObject({
      id: theirs.id,
      status: "ACCEPTED",
      handle: ana.handle,
      displayName: "Ana",
    });
    expect(await friendsOf(ana)).toMatchObject([{ spaceId: outcome.spaceId, name: "Bruno" }]);
    expect(await friendsOf(bruno)).toMatchObject([{ spaceId: outcome.spaceId, name: "Ana" }]);
  });

  it("refuses a request to oneself, to an unknown handle and to someone already a friend", async () => {
    const { ana, bruno } = await friends();
    expect(await problemOf(await send(ana, ana.handle.toUpperCase()))).toEqual([422, "OwnHandle"]);
    expect(await problemOf(await send(ana, freshHandle("nadie")))).toEqual([404, "UserNotFound"]);
    expect(await problemOf(await send(ana, "a b"))).toEqual([404, "UserNotFound"]);
    expect(await problemOf(await send(ana, bruno.handle))).toEqual([409, "AlreadyFriends"]);
    expect(await problemOf(await send(bruno, ana.handle))).toEqual([409, "AlreadyFriends"]);
  });

  it("rejecting is silent: it leaves Bruno's requests, Ana's stays as sent, and sending again answers it", async () => {
    const ana = await person("Ana");
    const bruno = await person("Bruno");
    const request = (await (await send(ana, bruno.handle)).json()) as RequestDto;
    expect(await problemOf(await reject(ana, request.id))).toEqual([404, "FriendRequestNotFound"]);
    expect((await reject(bruno, request.id)).status).toBe(204);
    expect(await requestsOf(bruno)).toEqual({ incoming: [], outgoing: [] });
    expect((await requestsOf(ana)).outgoing.map((r) => r.id)).toEqual([request.id]);
    const again = await send(ana, bruno.handle);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ id: request.id, status: "PENDING" });
    expect((await requestsOf(bruno)).incoming).toEqual([]);
    expect(await friendsOf(ana)).toEqual([]);
    // Answered: it cannot be accepted any more; Bruno asking Ana himself makes them friends.
    expect(await problemOf(await accept(bruno, request.id))).toEqual([404, "FriendRequestNotFound"]);
    const mine = await send(bruno, ana.handle);
    expect(await mine.json()).toMatchObject({ id: request.id, status: "ACCEPTED" });
    expect(await friendsOf(ana)).toHaveLength(1);
    expect((await requestsOf(ana)).outgoing).toEqual([]);
  });

  it("a malformed or unknown request id is FriendRequestNotFound", async () => {
    const ana = await person("Ana");
    expect(await problemOf(await accept(ana, "not-a-uuid"))).toEqual([404, "FriendRequestNotFound"]);
    expect(await problemOf(await reject(ana, randomUUID()))).toEqual([404, "FriendRequestNotFound"]);
  });
});

describe("Adding a guest friend (P339, S5)", () => {
  it("creates a direct space with the guest at once and answers the Amigos row", async () => {
    const ana = await registerUser("Ana");
    const added = await call(addGuestFriend, "POST", "/api/v1/me/friends", {
      user: ana,
      body: { displayName: "  Pedro  " },
    });
    expect(added.status).toBe(201);
    const row = (await added.json()) as FriendDto;
    expect(row).toMatchObject({
      other: { kind: "GUEST", displayName: "Pedro", nickname: null },
      name: "Pedro",
      net: cop(0),
    });
    expect(await friendsOf(ana)).toMatchObject([{ spaceId: row.spaceId, name: "Pedro" }]);
  });

  it("refuses a name the guest rules refuse", async () => {
    const ana = await registerUser("Ana");
    for (const displayName of ["   ", "x".repeat(101)]) {
      const response = await call(addGuestFriend, "POST", "/api/v1/me/friends", {
        user: ana,
        body: { displayName },
      });
      expect(await problemOf(response)).toEqual([422, "InvalidMemberName"]);
    }
    expect(await friendsOf(ana)).toEqual([]);
  });
});

describe("Removing a friend (P339, S7)", () => {
  it("refuses while they owe each other, and archives the pair's space once even; both lists drop it", async () => {
    const { ana, bruno, spaceId } = await friends();
    const brunoRow = (await friendsOf(ana))[0]!;
    const taxi = await call(directSplit, "POST", "/api/v1/direct-splits", {
      user: ana,
      body: {
        counterpart: { kind: "MEMBER", memberId: brunoRow.other.memberId },
        description: "Taxi",
        date: "2026-11-10",
        categoryKey: "restaurants",
        amount: cop(40_000),
        paidBy: "COUNTERPART",
      },
    });
    expect(taxi.status).toBe(201);
    expect(await problemOf(await remove(ana, spaceId))).toEqual([409, "FriendHasBalance"]);
    expect(await problemOf(await remove(bruno, spaceId))).toEqual([409, "FriendHasBalance"]);
    expect(await friendsOf(ana)).toHaveLength(1);

    // Even: a friend with nothing between them goes.
    const carla = await person("Carla");
    const request = (await (await send(ana, carla.handle)).json()) as RequestDto;
    const carlaSpace = ((await (await accept(carla, request.id)).json()) as { spaceId: string }).spaceId;
    expect((await remove(carla, carlaSpace)).status).toBe(204);
    expect((await friendsOf(ana)).map((f) => f.spaceId)).toEqual([spaceId]);
    expect(await friendsOf(carla)).toEqual([]);
    // The history stays readable (D8), and the pair may become friends again.
    expect(
      (
        await call(spaceBalances, "GET", `/api/v1/spaces/${carlaSpace}/balances`, {
          user: ana,
          params: { spaceId: carlaSpace },
        })
      ).status,
    ).toBe(200);
    expect(await problemOf(await remove(ana, carlaSpace))).toEqual([404, "SpaceNotFound"]);
    expect((await send(ana, carla.handle)).status).toBe(201);
  });

  it("removes a guest friend when even, and refuses a space the caller is not in or a shared space", async () => {
    const ana = await registerUser("Ana");
    const eva = await registerUser("Eva");
    const row = (await (
      await call(addGuestFriend, "POST", "/api/v1/me/friends", { user: ana, body: { displayName: "Pedro" } })
    ).json()) as FriendDto;
    expect(await problemOf(await remove(eva, row.spaceId))).toEqual([404, "SpaceNotFound"]);
    expect(await problemOf(await remove(ana, ana.spaceId))).toEqual([409, "NotADirectSpace"]);
    expect((await remove(ana, row.spaceId)).status).toBe(204);
    expect(await friendsOf(ana)).toEqual([]);
  });
});
