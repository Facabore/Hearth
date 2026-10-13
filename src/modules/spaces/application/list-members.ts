import { ok, type Result } from "@/shared/kernel";
import type { SpaceMember } from "../domain/space";
import type { MembersDeps } from "./members-deps";
import { authorizeSpaceAction } from "./space-access";

export type ListMembers = (input: { spaceId: string; userId: string }) => Promise<Result<SpaceMember[]>>;

/** HU-E1-05, HU-E1-10: every current member, guests included, in join order; any role may read. */
export const createListMembers =
  (deps: Pick<MembersDeps, "access" | "members">): ListMembers =>
  async ({ spaceId, userId }) => {
    const reader = await authorizeSpaceAction(deps.access, spaceId, userId, "space.read");
    if (!reader.ok) return reader;
    return ok(await deps.members.listCurrent(reader.value.spaceId));
  };
