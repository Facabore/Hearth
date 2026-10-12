import type { PeriodPolicy } from "@/shared/kernel";
import type { Space, SpaceKind, SpaceRole } from "../domain/space";

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
  listForUser(userId: string): Promise<SpaceSummary[]>;
}
