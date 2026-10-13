import { domainError, err, type Result } from "@/shared/kernel";
import { changeMemberRole } from "../domain/member";
import { can } from "../domain/permissions";
import type { SpaceMember, SpaceRole } from "../domain/space";
import type { MembersDeps } from "./members-deps";
import { authorizeSpaceAction } from "./space-access";

export type ChangeMemberRole = (input: {
  spaceId: string;
  userId: string;
  memberId: string;
  role: SpaceRole;
}) => Promise<Result<SpaceMember>>;

/** HU-E1-05: only owners change roles; guests have no role; a space keeps at least one OWNER. */
export const createChangeMemberRole =
  (deps: Pick<MembersDeps, "access" | "members" | "tm">): ChangeMemberRole =>
  (input) =>
    deps.tm.run(async () => {
      const owner = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "member.changeRole");
      if (!owner.ok) return owner;
      const { spaceId, memberId: actorId } = owner.value;
      // Locked: role changes of one space run one at a time, so two owners demoting each other cannot
      // leave it without an OWNER; the actor's own role is checked again on the locked rows.
      const current = await deps.members.listCurrent(spaceId, { lock: true });
      const actor = current.find((m) => m.id === actorId);
      if (!can(actor?.role ?? null, "member.changeRole")) return err(domainError("InsufficientRole"));
      const changed = changeMemberRole(current, input.memberId, input.role);
      if (!changed.ok) return changed;
      await deps.members.updateRole(spaceId, changed.value.id, input.role);
      return changed;
    });
