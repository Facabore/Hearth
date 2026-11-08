// Whole screens, which only the single-page app composes (ADR 0006); components import ./index.
export { DashboardFrame } from "./dashboard-frame";
export { LineDashboard } from "./lines/line-dashboard";
export { NoPlan } from "./lines/no-plan";
export { DashOverview } from "./overview/dash-overview";
export { UnifiedView } from "./unified/unified-view";
export { MyConsumptionScreen } from "./unified/my-consumption-screen";
export { FundTracking } from "./fund/fund-tracking";
export { MemberMatrix } from "./matrix/member-matrix";
export { SpendingChart } from "./by-group/spending-chart";
export { treeOf } from "./by-group/spending-tree";
export { unbudgetedNamesOf } from "./lines/unbudgeted-names";
export { LineTrend } from "./trend/line-trend";
export { PersonalTrend } from "./trend/personal-trend";
export { LazyCashFlowCalendar } from "./calendar/lazy-cash-flow-calendar";
