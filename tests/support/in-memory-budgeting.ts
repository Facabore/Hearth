import type {
  BudgetLine,
  BudgetPlan,
  BudgetPlanRepository,
  CategoryMapping,
  LineAllocation,
  MemberCapacity,
  PlanContents,
} from "@/modules/budgeting/application";
import type { StoredPeriod } from "@/shared/kernel";

const SEEDED = new Date("2026-10-14T12:00:00Z");
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Plans and their parts with their whole history; mirrors DrizzleBudgetPlanRepository (pinned by its integration tests). */
export class InMemoryBudgetPlans implements BudgetPlanRepository {
  plans: BudgetPlan[] = [];
  /** Current capacities per plan id, edited in place like budget_member_capacities. */
  readonly capacities = new Map<string, MemberCapacity[]>();
  /** Every line ever added, with its deletion time (D8: rows stay). */
  lines: { line: BudgetLine; deletedAt: Date | null }[] = [];
  /** Every mapping ever made; current ones have unmappedAt null. */
  mappings: { planId: string; mapping: CategoryMapping; mappedAt: Date; unmappedAt: Date | null }[] = [];
  /** Every allocation value ever set; current ones have supersededAt null. */
  allocations: { allocation: LineAllocation; setAt: Date; supersededAt: Date | null }[] = [];

  async add(plan: BudgetPlan): Promise<boolean> {
    if (this.plans.some((p) => p.spaceId === plan.spaceId && p.period.start === plan.period.start))
      return false;
    this.plans.push(plan);
    return true;
  }

  async find(spaceId: string, planId: string): Promise<BudgetPlan | null> {
    return this.plans.find((p) => p.spaceId === spaceId && p.id === planId) ?? null;
  }

  async storedPeriods(spaceId: string): Promise<StoredPeriod[]> {
    return this.plans
      .filter((p) => p.spaceId === spaceId)
      .map((p) => p.period)
      .sort((a, b) => compare(a.start, b.start));
  }

  async hasPlans(spaceId: string): Promise<boolean> {
    return this.plans.some((p) => p.spaceId === spaceId);
  }

  async lockForWrite(planId: string, expectedVersion: number | null): Promise<number | null> {
    const plan = this.plans.find((p) => p.id === planId);
    if (!plan || (expectedVersion !== null && plan.version !== expectedVersion)) return null;
    const version = plan.version + 1;
    this.plans = this.plans.map((p) => (p.id === planId ? { ...p, version } : p));
    return version;
  }

  async contents(planId: string): Promise<PlanContents> {
    const lines = this.lines
      .filter((r) => r.line.planId === planId && r.deletedAt === null)
      .map((r) => r.line)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || compare(a.id, b.id));
    const lineIds = new Set<string>(lines.map((l) => l.id));
    return {
      capacities: [...(this.capacities.get(planId) ?? [])].sort((a, b) => compare(a.memberId, b.memberId)),
      lines,
      mappings: this.mappings
        .filter((r) => r.planId === planId && r.unmappedAt === null)
        .map((r) => r.mapping)
        .sort((a, b) => compare(a.lineId, b.lineId) || compare(a.categoryId, b.categoryId)),
      allocations: this.allocations
        .filter((r) => lineIds.has(r.allocation.lineId) && r.supersededAt === null)
        .map((r) => r.allocation)
        .sort((a, b) => compare(a.lineId, b.lineId) || compare(a.memberId, b.memberId)),
    };
  }

  /** CapacityRepository, like DrizzleBudgetPlanRepository.setCapacities. */
  async setCapacities(planId: string, capacities: readonly MemberCapacity[]): Promise<void> {
    this.mergeCapacities(planId, capacities);
  }

  /** BudgetLineRepository, like DrizzleBudgetPlanRepository.addLine. */
  async addLine(line: BudgetLine): Promise<void> {
    this.lines.push({ line, deletedAt: null });
  }

  /** BudgetLineRepository: every field but the allocation rule, which only setAllocation changes. */
  async saveLine(line: BudgetLine): Promise<void> {
    this.lines = this.lines.map((r) =>
      r.line.id === line.id && r.deletedAt === null
        ? { ...r, line: { ...line, allocationRule: r.line.allocationRule } }
        : r,
    );
  }

  /** BudgetLineRepository: the row stays with deletedAt, and the line's current mappings end. */
  async deleteLine(planId: string, lineId: string, at: Date): Promise<void> {
    this.lines = this.lines.map((r) =>
      r.line.id === lineId && r.line.planId === planId && r.deletedAt === null ? { ...r, deletedAt: at } : r,
    );
    this.mappings = this.mappings.map((r) =>
      r.planId === planId && r.mapping.lineId === lineId && r.unmappedAt === null
        ? { ...r, unmappedAt: at }
        : r,
    );
  }

  /** Test setup: parts of a plan as earlier writes would have left them. */
  seed(planId: string, parts: Partial<PlanContents>): void {
    this.mergeCapacities(planId, parts.capacities ?? []);
    for (const line of parts.lines ?? []) this.lines.push({ line: { ...line, planId }, deletedAt: null });
    for (const mapping of parts.mappings ?? [])
      this.mappings.push({ planId, mapping, mappedAt: SEEDED, unmappedAt: null });
    for (const allocation of parts.allocations ?? []) {
      this.allocations.push({ allocation, setAt: SEEDED, supersededAt: null });
    }
  }

  private mergeCapacities(planId: string, capacities: readonly MemberCapacity[]): void {
    const kept = (this.capacities.get(planId) ?? []).filter(
      (c) => !capacities.some((n) => n.memberId === c.memberId),
    );
    this.capacities.set(planId, [...kept, ...capacities]);
  }
}
