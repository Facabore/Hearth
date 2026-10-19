import type { LocalDate } from "@/shared/kernel";
import type { ReportingDeps } from "./deps";

/** HU-E7-02, HU-E7-03: per-member sums of a space's live ledger within dates (spec 5.4, D7); bound to the ledger. */
export interface SpaceMemberSums {
  /** Per category and member: Σ the member's payments and Σ their shares of the space's expenses. */
  memberSumsByCategory(
    spaceId: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<
    readonly {
      readonly categoryId: string;
      readonly memberId: string;
      readonly paid: bigint;
      readonly consumed: bigint;
    }[]
  >;
  /** Per member: Σ their fund contributions recorded in the space (HU-E4-09). */
  fundContributionsByMember(
    spaceId: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<readonly { readonly memberId: string; readonly amount: bigint }[]>;
}

export interface MemberSumsDeps extends ReportingDeps {
  readonly sums: SpaceMemberSums;
}
