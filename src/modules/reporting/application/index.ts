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
export type { CashOut, ConsumptionGroup } from "../domain/unified-view";
export type {
  PersonalDeps,
  PersonalScope,
  PersonalSums,
  ReportCategories,
  SavingsAccountsOf,
} from "./personal-scope";
export {
  createGetUnifiedPersonalView,
  type GetUnifiedPersonalView,
  type UnifiedGroup,
  type UnifiedPersonalView,
} from "./get-unified-personal-view";
export { CHANGE_STATUSES, type Change, type ChangeStatus } from "../domain/trend";
export {
  createGetLineTrend,
  type GetLineTrend,
  type LineTrend,
  type LineTrendSeries,
  type TrendInput,
  type TrendPoint,
} from "./get-line-trend";
export {
  createGetPersonalTrend,
  type GetPersonalTrend,
  type PersonalTrend,
  type PersonalTrendInput,
  type PersonalTrendPoint,
} from "./get-personal-trend";
export type { TreeCategory, TreePlace } from "../domain/category-tree";
export type { CategoryTrees } from "./category-trees";
