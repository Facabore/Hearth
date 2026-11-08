import {
  authorizeSpaceAction,
  MANAGERS,
  requireRole,
  type SpaceAccess,
  type SpaceMembership,
} from "@/modules/spaces/application";
import { flatMap, type Result } from "@/shared/kernel";

/** HU-E3-02: OWNER and ADMIN (in a personal space, its owner) manage the category tree. */
export const authorizeManager = async (
  access: SpaceAccess,
  spaceId: string,
  userId: string,
): Promise<Result<SpaceMembership>> =>
  flatMap(await access(spaceId, userId), (m) => requireRole(m, MANAGERS));

/** P308: anyone who records in the space (OWNER, ADMIN, MEMBER) adds a category or subcategory; VIEWER never does. */
export const authorizeCreator = (access: SpaceAccess, spaceId: string, userId: string): Promise<Result<SpaceMembership>> =>
  authorizeSpaceAction(access, spaceId, userId, "category.create");
