import { domainError, err, ok, type Result, type TransactionManager } from "@/shared/kernel";
import { pairKeyOf } from "../domain/direct-space";
import { sideOf, type FriendRequest } from "../domain/friend-request";
import type { SpaceId } from "../domain/space";
import { directSpaceWithUser, type DirectSpaceDeps, type Requester } from "./split-with-person";

/** Ruling P339: friend requests, at most one open per pair of people (the database decides races). */
export interface FriendRequestRepository {
  /** The pair's open request (PENDING or REJECTED), locked until the transaction ends; null when there is none. */
  lockOpenBetween(pairKey: string): Promise<FriendRequest | null>;
  /** The open request with that id, locked; null for an unknown, malformed or closed one. */
  lockOpen(requestId: string): Promise<FriendRequest | null>;
  /** Adds a PENDING request; false, adding nothing, when the pair already has an open one. */
  addPending(request: FriendRequest & { readonly pairKey: string }): Promise<boolean>;
  decide(requestId: string, status: "ACCEPTED" | "REJECTED", decidedAt: Date): Promise<void>;
  /** The open requests the person sent or received, newest first. */
  listOpenFor(userId: string): Promise<FriendRequest[]>;
}

/** Ruling P339: the people a request names, read from the identity module through the composition root. */
export interface FriendRequestPeople {
  /** The person holding exactly this @usuario, ignoring case; null for an unknown or malformed one. */
  byHandle(handle: string): Promise<{ userId: string; handle: string; displayName: string } | null>;
  /** The handle (null when they have none) and name of each known id. */
  holdersOf(
    userIds: readonly string[],
  ): Promise<{ userId: string; handle: string | null; displayName: string }[]>;
}

export interface FriendRequestsDeps extends DirectSpaceDeps {
  readonly requests: FriendRequestRepository;
  readonly people: FriendRequestPeople;
  /** The same per-person window as the @ lookup (S3): a request names a handle too. */
  readonly throttle: { allows(userId: string): boolean };
  readonly tm: TransactionManager;
}

/** Ruling P339: a request as its viewer sees it, named by the other person. */
export interface FriendRequestView {
  readonly id: string;
  readonly handle: string | null;
  readonly displayName: string;
  readonly createdAt: Date;
}

/** Ruling P339: what sending answers: the request, new or already open, or the other's request it accepted. */
export type SentFriendRequest = FriendRequestView & { readonly created: boolean } & (
    { readonly status: "PENDING" } | { readonly status: "ACCEPTED"; readonly spaceId: SpaceId }
  );

export type SendFriendRequest = (
  input: Requester & { readonly handle: string },
) => Promise<Result<SentFriendRequest>>;

export type ListFriendRequests = (
  userId: string,
) => Promise<Result<{ readonly incoming: FriendRequestView[]; readonly outgoing: FriendRequestView[] }>>;

export type AnswerFriendRequest<T> = (
  input: Requester & { readonly requestId: string },
) => Promise<Result<T>>;

/** The pending request the person received; anything else is FriendRequestNotFound, so a request never leaks. */
const lockReceived = async (
  deps: FriendRequestsDeps,
  requestId: string,
  userId: string,
): Promise<Result<FriendRequest>> => {
  const request = await deps.requests.lockOpen(requestId);
  return request !== null && sideOf(request, userId) === "incoming"
    ? ok(request)
    : err(domainError("FriendRequestNotFound"));
};

/** Accepts the request: the pair's direct space, reused when there is one (P339, S4), then the request is closed. */
const acceptRequest = async (
  deps: FriendRequestsDeps,
  requester: Requester,
  request: FriendRequest,
  sender: { readonly userId: string; readonly displayName: string },
): Promise<Result<SpaceId>> => {
  const space = await directSpaceWithUser(deps, requester, {
    userId: sender.userId,
    displayName: sender.displayName,
  });
  if (!space.ok) return space;
  await deps.requests.decide(request.id, "ACCEPTED", deps.clock.now());
  return ok(space.value.spaceId);
};

/**
 * Ruling P339 (S4): a request to someone's exact @. To oneself is OwnHandle, to an unknown or malformed @ is
 * UserNotFound, and to someone already a friend (an active direct space between them) is AlreadyFriends. When the pair
 * already has an open request, the person's own is answered as it is (created false), and the other's is accepted, so
 * the two become friends at once. The pair's open request is locked first, so two people asking each other at once
 * end with one request, accepted by the later of the two.
 */
export const createSendFriendRequest =
  (deps: FriendRequestsDeps): SendFriendRequest =>
  async (input) => {
    if (!deps.throttle.allows(input.userId)) return err(domainError("TooManyRequests"));
    const target = await deps.people.byHandle(input.handle);
    if (target === null) return err(domainError("UserNotFound"));
    if (target.userId === input.userId) return err(domainError("OwnHandle"));
    const named = { handle: target.handle, displayName: target.displayName };
    const pairKey = pairKeyOf(input.userId, target.userId);
    return deps.tm.run<SentFriendRequest>(async () => {
      if ((await deps.direct.findByPairKey(pairKey)) !== null) return err(domainError("AlreadyFriends"));
      let open = await deps.requests.lockOpenBetween(pairKey);
      if (open === null) {
        const request: FriendRequest = {
          id: deps.ids.next<"FriendRequest">(),
          fromUserId: input.userId,
          toUserId: target.userId,
          status: "PENDING",
          createdAt: deps.clock.now(),
          decidedAt: null,
        };
        if (await deps.requests.addPending({ ...request, pairKey })) {
          return ok({
            id: request.id,
            ...named,
            createdAt: request.createdAt,
            created: true,
            status: "PENDING",
          });
        }
        // A concurrent request of the same pair was stored first: answer as if it had been there already.
        open = await deps.requests.lockOpenBetween(pairKey);
        if (open === null) return err(domainError("AlreadyFriends"));
      }
      const view = { id: open.id, ...named, createdAt: open.createdAt, created: false };
      if (open.fromUserId === input.userId) return ok({ ...view, status: "PENDING" });
      const spaceId = await acceptRequest(deps, input, open, target);
      return spaceId.ok ? ok({ ...view, status: "ACCEPTED", spaceId: spaceId.value }) : spaceId;
    });
  };

/** Ruling P339 (S4): the requests the person received and still has to answer, and the ones they sent, newest first. */
export const createListFriendRequests =
  (deps: Pick<FriendRequestsDeps, "requests" | "people">): ListFriendRequests =>
  async (userId) => {
    const open = await deps.requests.listOpenFor(userId);
    const otherOf = (request: FriendRequest) =>
      request.fromUserId === userId ? request.toUserId : request.fromUserId;
    const people = new Map((await deps.people.holdersOf(open.map(otherOf))).map((p) => [p.userId, p]));
    const incoming: FriendRequestView[] = [];
    const outgoing: FriendRequestView[] = [];
    for (const request of open) {
      const side = sideOf(request, userId);
      const other = people.get(otherOf(request));
      if (side === null || other === undefined) continue;
      (side === "incoming" ? incoming : outgoing).push({
        id: request.id,
        handle: other.handle,
        displayName: other.displayName,
        createdAt: request.createdAt,
      });
    }
    return ok({ incoming, outgoing });
  };

/** Ruling P339 (S4): the recipient accepts; the pair's direct space is created, or the active one reused. */
export const createAcceptFriendRequest =
  (deps: FriendRequestsDeps): AnswerFriendRequest<{ readonly spaceId: SpaceId }> =>
  (input) =>
    deps.tm.run(async () => {
      const request = await lockReceived(deps, input.requestId, input.userId);
      if (!request.ok) return request;
      const [sender] = await deps.people.holdersOf([request.value.fromUserId]);
      // An account that is gone took its requests with it (ON DELETE CASCADE); a missing one is a broken invariant.
      if (sender === undefined) throw new Error(`friend request ${request.value.id} has no sender`);
      const spaceId = await acceptRequest(deps, input, request.value, sender);
      return spaceId.ok ? ok({ spaceId: spaceId.value }) : spaceId;
    });

/** Ruling P339 (S4): the recipient turns it down, silently: the sender keeps seeing it as sent. */
export const createRejectFriendRequest =
  (deps: FriendRequestsDeps): AnswerFriendRequest<void> =>
  (input) =>
    deps.tm.run(async () => {
      const request = await lockReceived(deps, input.requestId, input.userId);
      if (!request.ok) return request;
      await deps.requests.decide(request.value.id, "REJECTED", deps.clock.now());
      return ok(undefined);
    });
