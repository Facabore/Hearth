import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { isUuid } from "@/shared/kernel";
import type { FriendRequestRepository } from "../application/friend-requests";
import { OPEN_STATUSES, type FriendRequest } from "../domain/friend-request";
import { friendRequests } from "./spaces.schema";

const columns = {
  id: friendRequests.id,
  fromUserId: friendRequests.fromUserId,
  toUserId: friendRequests.toUserId,
  status: friendRequests.status,
  createdAt: friendRequests.createdAt,
  decidedAt: friendRequests.decidedAt,
};

const isOpen = inArray(friendRequests.status, [...OPEN_STATUSES]);

/** Ruling P339: friend requests in PostgreSQL, read and written inside the caller's transaction when there is one. */
export class DrizzleFriendRequests implements FriendRequestRepository {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async lockOpenBetween(pairKey: string): Promise<FriendRequest | null> {
    const [row] = await this.tm
      .executor()
      .select(columns)
      .from(friendRequests)
      .where(and(eq(friendRequests.pairKey, pairKey), isOpen))
      .for("update");
    return row ?? null;
  }

  async lockOpen(requestId: string): Promise<FriendRequest | null> {
    // Anything that is not a UUID would fail the uuid cast; it names no request.
    if (!isUuid(requestId)) return null;
    const [row] = await this.tm
      .executor()
      .select(columns)
      .from(friendRequests)
      .where(and(eq(friendRequests.id, requestId), isOpen))
      .for("update");
    return row ?? null;
  }

  /** ON CONFLICT DO NOTHING on the pair's open-request index: a concurrent request of the pair wins, and this adds nothing. */
  async addPending(request: FriendRequest & { readonly pairKey: string }): Promise<boolean> {
    const added = await this.tm
      .executor()
      .insert(friendRequests)
      .values({
        id: request.id,
        fromUserId: request.fromUserId,
        toUserId: request.toUserId,
        pairKey: request.pairKey,
        status: "PENDING",
        createdAt: request.createdAt,
        decidedAt: null,
      })
      .onConflictDoNothing()
      .returning({ id: friendRequests.id });
    return added.length > 0;
  }

  async decide(requestId: string, status: "ACCEPTED" | "REJECTED", decidedAt: Date): Promise<void> {
    if (!isUuid(requestId)) return;
    await this.tm
      .executor()
      .update(friendRequests)
      .set({ status, decidedAt })
      .where(eq(friendRequests.id, requestId));
  }

  async listOpenFor(userId: string): Promise<FriendRequest[]> {
    return this.tm
      .executor()
      .select(columns)
      .from(friendRequests)
      .where(and(or(eq(friendRequests.fromUserId, userId), eq(friendRequests.toUserId, userId)), isOpen))
      .orderBy(desc(friendRequests.createdAt), desc(friendRequests.id));
  }
}
