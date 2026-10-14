import type { PeriodPolicy } from "@/shared/kernel";
import type { SpaceId, SpaceKind, SpaceMemberId, SpaceRole } from "../domain/space";

/** The acting user's view of one space they currently belong to; other modules authorize with it. */
export interface SpaceMembership {
  readonly spaceId: SpaceId;
  readonly name: string;
  readonly spaceKind: SpaceKind;
  readonly currency: string;
  readonly periodPolicy: PeriodPolicy;
  readonly memberId: SpaceMemberId;
  readonly userId: string;
  readonly role: SpaceRole | null;
  /** HU-E1-09: an archived space only reads; SpaceAccess refuses everything else. */
  readonly archived: boolean;
}

export interface SpaceSettings {
  readonly name: string;
  readonly currency: string;
  readonly periodPolicy: PeriodPolicy;
}

export interface SpaceSettingsRepository {
  /** Null for malformed ids, unknown spaces and non-members; archived spaces are found and flagged. */
  findMembership(spaceId: string, userId: string): Promise<SpaceMembership | null>;
  updateSettings(spaceId: SpaceId, settings: SpaceSettings): Promise<void>;
}
