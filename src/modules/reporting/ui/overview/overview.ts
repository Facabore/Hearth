// Client-safe: the desktop overview and the single-page app (ADR 0006) read this type; the loader reads the server API.
import type {
  FundTrackingDto,
  LineTrendDto,
  MemberMatrixDto,
  SpaceMemberDto,
  SpendingByGroupDto,
} from "@/shared/ui/api/dto";

/** The desktop panels of a shared space's Plan tab; each is null when its read failed. */
export interface Overview {
  readonly matrix: MemberMatrixDto | null;
  readonly fund: FundTrackingDto | null;
  readonly groups: SpendingByGroupDto | null;
  readonly trend: LineTrendDto | null;
  readonly members: SpaceMemberDto[];
}
