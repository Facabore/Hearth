import { domainError, err, ok, type Result } from "@/shared/kernel";
import { guestMember } from "../domain/member";
import { ensureCanAddMember, type SpaceMember } from "../domain/space";
import type { MembersDeps } from "./members-deps";
import { authorizeSpaceAction } from "./space-access";

export interface GuestToAdd {
  readonly displayName: string;
  readonly contactEmail?: string;
}

export type AddGuestMembers = (input: {
  spaceId: string;
  userId: string;
  guests: readonly GuestToAdd[];
}) => Promise<Result<SpaceMember[]>>;

/** The refusal of the guest at `index`, with its card's index as the public `guest` detail (P309). */
const forGuest = (index: number, error: { code: string; details?: Readonly<Record<string, unknown>> }) =>
  err(domainError(error.code, { ...error.details, guest: index }));

/**
 * P309 (HU-E1-10, D15): MEMBER or above adds several people without an account at once, all or nothing. Each guest's
 * name is checked against the current members and the guests before it in the same batch; the first refusal adds
 * nobody and names that guest's index.
 */
export const createAddGuestMembers =
  (deps: MembersDeps): AddGuestMembers =>
  (input) =>
    deps.tm.run(async () => {
      const writer = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "guest.add");
      if (!writer.ok) return writer;
      const space = writer.value;
      const shareable = ensureCanAddMember({ kind: space.spaceKind });
      if (!shareable.ok) return shareable;
      const current = await deps.members.listCurrent(space.spaceId);
      const accepted: SpaceMember[] = [];
      for (const [index, entry] of input.guests.entries()) {
        const guest = guestMember({
          id: deps.ids.next<"SpaceMember">(),
          displayName: entry.displayName,
          contactEmail: entry.contactEmail ?? null,
          now: deps.clock.now(),
          current: [...current, ...accepted],
        });
        if (!guest.ok) return forGuest(index, guest.error);
        accepted.push(guest.value);
      }
      // The database has the last word: a concurrent addition may have taken a name meanwhile. The Err rolls back
      // the guests already written in this transaction.
      for (const [index, guest] of accepted.entries()) {
        const outcome = await deps.members.addMember(space.spaceId, guest);
        if (outcome !== "added") return forGuest(index, domainError("MemberNameTaken"));
      }
      return ok(accepted);
    });
