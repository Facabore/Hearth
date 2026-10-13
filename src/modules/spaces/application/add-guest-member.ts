import { domainError, err, type Result } from "@/shared/kernel";
import { guestMember } from "../domain/member";
import { ensureCanAddMember, type SpaceMember } from "../domain/space";
import type { MembersDeps } from "./members-deps";
import { authorizeSpaceAction } from "./space-access";

export type AddGuestMember = (input: {
  spaceId: string;
  userId: string;
  displayName: string;
  contactEmail?: string;
}) => Promise<Result<SpaceMember>>;

/** HU-E1-10, D15: MEMBER or above adds someone without an account; the guest exists only in this space. */
export const createAddGuestMember =
  (deps: MembersDeps): AddGuestMember =>
  (input) =>
    deps.tm.run(async () => {
      const writer = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "guest.add");
      if (!writer.ok) return writer;
      const space = writer.value;
      const shareable = ensureCanAddMember({ kind: space.spaceKind });
      if (!shareable.ok) return shareable;
      const guest = guestMember({
        id: deps.ids.next<"SpaceMember">(),
        displayName: input.displayName,
        contactEmail: input.contactEmail ?? null,
        now: deps.clock.now(),
        current: await deps.members.listCurrent(space.spaceId),
      });
      if (!guest.ok) return guest;
      // The database has the last word: a concurrent addition may have taken the name meanwhile.
      const outcome = await deps.members.addMember(space.spaceId, guest.value);
      return outcome === "added" ? guest : err(domainError("MemberNameTaken"));
    });
