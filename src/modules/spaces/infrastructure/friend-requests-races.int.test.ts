import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { FixedClock, ok } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { unwrap } from "../../../../tests/support/fakes";
import { userFixture } from "../../../../tests/support/fixtures";
import { bothSettled, heldBy, holder } from "../../../../tests/support/locks";
import {
  createAcceptFriendRequest,
  createListFriendRequests,
  createSendFriendRequest,
  type FriendRequestRepository,
  type FriendRequestsDeps,
} from "../application/friend-requests";
import { createSpaceAccess } from "../application/space-access";
import { pairKeyOf } from "../domain/direct-space";
import { DrizzleFriendRequests } from "./drizzle-friend-requests";
import { DrizzleSpaceRepository } from "./drizzle-space-repository";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const spaces = new DrizzleSpaceRepository(tm);
const stored = new DrizzleFriendRequests(tm);

afterAll(() => pool.end());

type Person = { id: string; name: string; handle: string };

const people = async (): Promise<[Person, Person]> => {
  const ana = await userFixture(pool, "Ana");
  const bruno = await userFixture(pool, "Bruno");
  return [
    { ...ana, handle: `ana_${ana.id.slice(0, 8)}` },
    { ...bruno, handle: `bruno_${bruno.id.slice(0, 8)}` },
  ];
};

const depsFor = (everyone: readonly Person[], requests: FriendRequestRepository): FriendRequestsDeps => ({
  access: createSpaceAccess(spaces),
  spaces,
  direct: spaces,
  onCreated: async () => ok(undefined),
  ids: new UuidV7IdGenerator(),
  clock: new FixedClock(new Date("2026-11-17T12:00:00Z")),
  tm,
  requests,
  people: {
    byHandle: async (handle) => {
      const found = everyone.find((p) => p.handle === handle);
      return found ? { userId: found.id, handle: found.handle, displayName: found.name } : null;
    },
    holdersOf: async (ids) =>
      everyone
        .filter((p) => ids.includes(p.id))
        .map((p) => ({ userId: p.id, handle: p.handle, displayName: p.name })),
  },
  throttle: { allows: () => true },
});

const asRequester = (p: Person) => ({ userId: p.id, userName: p.name, locale: "es" });

const directSpacesOf = async (a: Person, b: Person) =>
  (
    await pool.query(
      "SELECT count(*)::int AS n FROM spaces WHERE direct_pair_key = $1 AND archived_at IS NULL",
      [pairKeyOf(a.id, b.id)],
    )
  ).rows[0].n as number;

describe("friend requests under concurrency (P339)", () => {
  it("two people asking each other at once end with one request, accepted, and one direct space", async () => {
    const [ana, bruno] = await people();
    const h = holder(tm, pool);
    // Ana's request stops inside its transaction right after it stored her pending request.
    const held: FriendRequestRepository = {
      lockOpenBetween: (key) => stored.lockOpenBetween(key),
      lockOpen: (id) => stored.lockOpen(id),
      decide: (id, status, at) => stored.decide(id, status, at),
      listOpenFor: (id) => stored.listOpenFor(id),
      addPending: async (request) => {
        const added = await stored.addPending(request);
        await h.hold();
        return added;
      },
    };
    const anaSends = createSendFriendRequest(depsFor([ana, bruno], held))({
      ...asRequester(ana),
      handle: bruno.handle,
    });
    await heldBy(h, anaSends);
    // Bruno's request queues behind Ana's uncommitted one on the pair's open-request index, then accepts it.
    const brunoSends = createSendFriendRequest(depsFor([ana, bruno], stored))({
      ...asRequester(bruno),
      handle: ana.handle,
    });
    const [mine, his] = await bothSettled(anaSends, brunoSends);
    expect(unwrap(mine)).toMatchObject({ status: "PENDING", created: true });
    expect(unwrap(his)).toMatchObject({ id: unwrap(mine).id, status: "ACCEPTED", created: false });
    expect(await directSpacesOf(ana, bruno)).toBe(1);
    const lists = createListFriendRequests(depsFor([ana, bruno], stored));
    expect(unwrap(await lists(ana.id))).toEqual({ incoming: [], outgoing: [] });
  });

  it("accepting while a second accept of the same request waits creates one direct space; the second finds nothing", async () => {
    const [ana, bruno] = await people();
    const sent = unwrap(
      await createSendFriendRequest(depsFor([ana, bruno], stored))({
        ...asRequester(ana),
        handle: bruno.handle,
      }),
    );
    const h = holder(tm, pool);
    const held: FriendRequestRepository = {
      lockOpenBetween: (key) => stored.lockOpenBetween(key),
      addPending: (request) => stored.addPending(request),
      listOpenFor: (id) => stored.listOpenFor(id),
      decide: (id, status, at) => stored.decide(id, status, at),
      lockOpen: async (id) => {
        const locked = await stored.lockOpen(id);
        await h.hold();
        return locked;
      },
    };
    const first = createAcceptFriendRequest(depsFor([ana, bruno], held))({
      ...asRequester(bruno),
      requestId: sent.id,
    });
    await heldBy(h, first);
    const second = createAcceptFriendRequest(depsFor([ana, bruno], stored))({
      ...asRequester(bruno),
      requestId: sent.id,
    });
    const [accepted, again] = await bothSettled(first, second);
    expect(accepted.ok).toBe(true);
    expect(again).toMatchObject({ ok: false, error: { code: "FriendRequestNotFound" } });
    expect(await directSpacesOf(ana, bruno)).toBe(1);
  });
});
