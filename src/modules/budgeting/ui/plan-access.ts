import { addDays, type LocalDate } from "@/shared/kernel/local-date";
import type { BudgetPlanDto, SpaceDto, SpaceMemberDto } from "@/shared/ui/api/dto";

/** Ruling P207: OWNER and ADMIN manage plans (the permission matrix's plan.manage, HU-E6-01). */
export const canManage = (role: SpaceDto["role"]): boolean => role === "OWNER" || role === "ADMIN";

/** HU-E6-02, D17: managers set anyone's capacity; a registered MEMBER only their own (capacity.setOwn). */
export const capacityEditable = (
  role: SpaceDto["role"],
  member: Pick<SpaceMemberDto, "userId">,
  viewerUserId: string,
): boolean => canManage(role) || (role === "MEMBER" && member.userId === viewerUserId);

/** HU-E6-07: a CLOSED plan refuses every edit. */
export const isEditable = (plan: Pick<BudgetPlanDto, "status">): boolean => plan.status !== "CLOSED";

/** HU-E6-07: the first day a plan may close, the day after its period's last day. */
export const closesFrom = (plan: Pick<BudgetPlanDto, "period">): string =>
  addDays(plan.period.endDate as LocalDate, 1);

export const canCloseOn = (plan: Pick<BudgetPlanDto, "status" | "period">, today: string): boolean =>
  plan.status === "ACTIVE" && today >= closesFrom(plan);

/** The viewer's own member row in the space, or null. */
export const memberOf = (members: readonly SpaceMemberDto[], userId: string): SpaceMemberDto | null =>
  members.find((member) => member.userId === userId) ?? null;
