export type { ReportingDeps } from "./deps";
export type { ReportPlan, SpaceReport, SpaceReportInput } from "./space-report";
export {
  createGetLineDashboard,
  type DashboardLine,
  type GetLineDashboard,
  type LineDashboard,
  type UnbudgetedSpending,
} from "./get-line-dashboard";
export {
  GAP_STATUSES,
  MATRIX_REASONS,
  type GapStatus,
  type MatrixCell,
  type MatrixReason,
} from "../domain/member-matrix";
export type { FundContribution } from "../domain/fund-contributions";
export type { MemberSumsDeps, SpaceMemberSums } from "./member-sums";
export {
  createGetMemberLineMatrix,
  type GetMemberLineMatrix,
  type MatrixLine,
  type MemberLineMatrix,
} from "./get-member-line-matrix";
export {
  createGetFundContributions,
  type FundContributionReport,
  type GetFundContributions,
} from "./get-fund-contributions";
