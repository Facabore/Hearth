import type { PlanViewDeps } from "@/modules/budgeting/application";
import type { SpaceAccess } from "@/modules/spaces/application";

/**
 * What every space report needs (HU-E7-01 … HU-E7-03, HU-E7-05): the space access, plus what reading a plan's
 * figures takes (its current members (ruling P7), budgeting's plans, categories and savings accounts, and the
 * ledger's spending), so a report's figures are the plan's figures, derived on read (D7, ruling P32). The
 * composition root binds the adapters it gives budgeting.
 */
export interface ReportingDeps extends PlanViewDeps {
  readonly access: SpaceAccess;
}
