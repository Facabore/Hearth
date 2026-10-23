import type { components, paths } from "./schema";

type Json<T> = T extends { content: { "application/json": infer B } } ? B : never;

export type MeDto = Json<paths["/api/v1/me"]["get"]["responses"][200]>;
/** Ruling P143: whether sign-up is open to anyone or closed to invitees. */
export type SignUpMode = Json<paths["/api/v1/auth/sign-up"]["get"]["responses"][200]>["signUp"];
export type SpaceListDto = Json<paths["/api/v1/spaces"]["get"]["responses"][200]>;
export type SpaceDto = components["schemas"]["Space"];
export type AccountListDto = Json<paths["/api/v1/spaces/{spaceId}/accounts"]["get"]["responses"][200]>;
export type AccountDto = components["schemas"]["Account"];
export type TransactionPageDto = Json<
  paths["/api/v1/spaces/{spaceId}/transactions"]["get"]["responses"][200]
>;
export type TransactionDto = TransactionPageDto["items"][number];
export type CategoryGroupDto = components["schemas"]["CategoryGroup"];
export type CategoryDto = components["schemas"]["Category"];
export type PeriodDto = Json<
  paths["/api/v1/spaces/{spaceId}/periods"]["get"]["responses"][200]
>["items"][number];
export type MoneyDto = components["schemas"]["Money"];
export type ProblemDto = components["schemas"]["Problem"];
export type MemberDto = components["schemas"]["SpaceMember"];
export type InvitationDto = components["schemas"]["Invitation"];
export type CreatedInvitationDto = Json<
  paths["/api/v1/spaces/{spaceId}/invitations"]["post"]["responses"][201]
>;
export type InvitationPreviewDto = components["schemas"]["InvitationPreview"];
export type ClaimPreviewDto = components["schemas"]["ClaimPreview"];
export type BalancesDto = Json<paths["/api/v1/spaces/{spaceId}/balances"]["get"]["responses"][200]>;
export type SuggestionDto = Json<
  paths["/api/v1/spaces/{spaceId}/balances/suggestions"]["get"]["responses"][200]
>["suggestions"][number];
export type BalanceHistoryDto = Json<
  paths["/api/v1/spaces/{spaceId}/members/{memberId}/balance-history"]["get"]["responses"][200]
>;
export type DefaultSplitDto = Json<paths["/api/v1/spaces/{spaceId}/default-split"]["get"]["responses"][200]>;
export type RecordedExpenseDto = components["schemas"]["RecordedExpense"];
export type DirectSplitDto = Json<paths["/api/v1/direct-splits"]["post"]["responses"][201]>;
export type LineDashboardDto = Json<paths["/api/v1/spaces/{spaceId}/reports/lines"]["get"]["responses"][200]>;
/** The plan a report reads, whatever its status (M4 ruling P33). */
export type ReportPlanDto = NonNullable<LineDashboardDto["plan"]>;
export type PlanStatus = ReportPlanDto["status"];
export type BudgetPlanDto = components["schemas"]["BudgetPlan"];
export type PlanLineDto = BudgetPlanDto["lines"][number];
export type SpaceMemberDto = components["schemas"]["SpaceMember"];
/** The caller's own capacity suggestion (D17): private to its member, never part of the plan. */
export type CapacitySuggestionDto = Json<
  paths["/api/v1/spaces/{spaceId}/plans/{planId}/capacity-suggestion"]["get"]["responses"][200]
>;
export type MemberMatrixDto = Json<
  paths["/api/v1/spaces/{spaceId}/reports/member-matrix"]["get"]["responses"][200]
>;
export type FundTrackingDto = Json<
  paths["/api/v1/spaces/{spaceId}/reports/fund-contributions"]["get"]["responses"][200]
>;
export type SpendingByGroupDto = Json<
  paths["/api/v1/spaces/{spaceId}/reports/spending-by-group"]["get"]["responses"][200]
>;
export type PersonalSpendingByGroupDto = Json<
  paths["/api/v1/me/reports/spending-by-group"]["get"]["responses"][200]
>;
