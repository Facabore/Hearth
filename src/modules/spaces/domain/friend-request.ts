/**
 * Ruling P339: a friend request from one registered person to another. PENDING until the recipient answers; ACCEPTED
 * once the pair has its direct space; REJECTED when the recipient turned it down, which the sender is never told (S4).
 */
export type FriendRequestStatus = "PENDING" | "ACCEPTED" | "REJECTED";

export interface FriendRequest {
  readonly id: string;
  readonly fromUserId: string;
  readonly toUserId: string;
  readonly status: FriendRequestStatus;
  readonly createdAt: Date;
  readonly decidedAt: Date | null;
}

/**
 * Ruling P339 (S4): the statuses of a request still open between a pair, one at most. A rejected one stays open for
 * its sender, who keeps seeing it as sent, so sending again answers it instead of asking anew; only an acceptance
 * closes it.
 */
export const OPEN_STATUSES: readonly FriendRequestStatus[] = ["PENDING", "REJECTED"];

/** Ruling P339: how the person sees a request: incoming only while pending, outgoing while open, else not at all. */
export const sideOf = (request: FriendRequest, userId: string): "incoming" | "outgoing" | null => {
  if (request.fromUserId === userId) return OPEN_STATUSES.includes(request.status) ? "outgoing" : null;
  if (request.toUserId === userId) return request.status === "PENDING" ? "incoming" : null;
  return null;
};
