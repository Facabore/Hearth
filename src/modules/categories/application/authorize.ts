import { MANAGERS, requireRole, type SpaceAccess, type SpaceMembership } from "@/modules/spaces/application";
import { flatMap, type Result } from "@/shared/kernel";

/** HU-E3-02: OWNER and ADMIN (in a personal space, its owner) manage the category tree. */
export const authorizeManager = async (
  access: SpaceAccess,
  spaceId: string,
  userId: string,
): Promise<Result<SpaceMembership>> =>
  flatMap(await access(spaceId, userId), (m) => requireRole(m, MANAGERS));
