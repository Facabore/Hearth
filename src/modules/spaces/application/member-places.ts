import type { PeriodPolicy } from "@/shared/kernel";
import type { SpaceId, SpaceKind, SpaceMemberId } from "../domain/space";

/** HU-E7-04, D15: one member row of a user in one space, current or former; a claimed guest place included. */
export interface MemberPlace {
  readonly memberId: SpaceMemberId;
  readonly spaceId: SpaceId;
  readonly spaceName: string;
  readonly spaceKind: SpaceKind;
  readonly currency: string;
  readonly periodPolicy: PeriodPolicy;
}

export interface MemberPlaceRepository {
  /**
   * Every member row linked to the user (spec 5.4: the unified view works through all of them), rows the user left
   * and archived spaces included, oldest space first; `[]` for unknown users.
   */
  placesOf(userId: string): Promise<MemberPlace[]>;
}
