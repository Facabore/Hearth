import type { PeriodPolicy } from "@/shared/kernel";
import type { Space, SpaceId, SpaceKind, SpaceRole } from "../domain/space";

export interface SpaceSummary {
  readonly id: string;
  readonly name: string;
  readonly kind: SpaceKind;
  readonly currency: string;
  readonly periodPolicy: PeriodPolicy;
  readonly role: SpaceRole | null;
}

export interface SpaceRepository {
  add(space: Space): Promise<void>;
  hasPersonalSpace(userId: string): Promise<boolean>;
  /** The spaces the user currently belongs to: the active ones, and the archived ones too with `includeArchived`. */
  listForUser(userId: string, options?: { readonly includeArchived?: boolean }): Promise<SpaceSummary[]>;
}

/** HU-E1-09: archiving keeps the space and its history; only archivedAt changes, once. */
export interface SpaceArchiveRepository {
  archive(spaceId: SpaceId, archivedAt: Date): Promise<void>;
}
