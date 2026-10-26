import type {
  AllocationRule,
  AllocationValue,
  BudgetLine,
  BudgetPlan,
  BudgetPlanRepository,
  CategoryMapping,
  LineAllocation,
  MemberCapacity,
  PlanContents,
  PlanStatus,
} from "@/modules/budgeting/application";
import type { LocalDate, StoredPeriod } from "@/shared/kernel";

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

  async closedCopiesOf(spaceId: string, planId: string): Promise<BudgetPlan[]> {
    return this.plans
      .filter((p) => p.spaceId === spaceId && p.createdFrom === planId && p.status === "CLOSED")
      .sort((a, b) => compare(a.period.start, b.period.start));
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

  /** Like DrizzleBudgetPlanRepository.covering; there is nothing to lock in memory. */
  async covering(spaceId: string, date: LocalDate): Promise<BudgetPlan | null> {
    const matching = this.plans.filter(
      (p) => p.spaceId === spaceId && p.period.start <= date && date <= p.period.end,
    );
    // D10 keeps stored periods from overlapping; the order only makes a violation deterministic.
    return matching.sort((a, b) => compare(b.period.start, a.period.start))[0] ?? null;
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

  /**
   * BudgetLineRepository, like DrizzleBudgetPlanRepository.saveLine: a current line of the line's own plan, and only
   * the fields a request changes; its plan, origin, creation time and allocation rule stay.
   */
  async saveLine(line: BudgetLine): Promise<void> {
    const { name, plannedAmount, funding, savingsAccountIds, rolloverMode, isCatchAll } = line;
    this.lines = this.lines.map((r) =>
      r.line.id === line.id && r.line.planId === line.planId && r.deletedAt === null
        ? {
            ...r,
            line: { ...r.line, name, plannedAmount, funding, savingsAccountIds, rolloverMode, isCatchAll },
          }
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

  /** CategoryMappingRepository, like DrizzleBudgetPlanRepository.mapCategories. */
  async mapCategories(
    planId: string,
    lineId: string,
    categoryIds: readonly string[],
    at: Date,
  ): Promise<void> {
    if (!this.hasCurrentLine(planId, lineId)) return;
    const keep = new Set(categoryIds);
    this.mappings = this.mappings.map((r) =>
      r.mapping.lineId === lineId && r.unmappedAt === null && !keep.has(r.mapping.categoryId)
        ? { ...r, unmappedAt: at }
        : r,
    );
    const current = new Set(
      this.mappings
        .filter((r) => r.mapping.lineId === lineId && r.unmappedAt === null)
        .map((r) => r.mapping.categoryId),
    );
    for (const categoryId of categoryIds.filter((id) => !current.has(id))) {
      this.mappings.push({ planId, mapping: { lineId, categoryId }, mappedAt: at, unmappedAt: null });
    }
  }

  /** CategoryMappingRepository: every mapping ever made counts. */
  async isCategoryMapped(categoryId: string): Promise<boolean> {
    return this.mappings.some((r) => r.mapping.categoryId === categoryId);
  }

  /** AllocationRepository, like DrizzleBudgetPlanRepository.setAllocation. */
  async setAllocation(
    planId: string,
    lineId: string,
    rule: AllocationRule,
    values: readonly AllocationValue[],
    at: Date,
  ): Promise<void> {
    if (!this.hasCurrentLine(planId, lineId)) return;
    this.lines = this.lines.map((r) =>
      r.line.id === lineId ? { ...r, line: { ...r.line, allocationRule: rule } } : r,
    );
    this.allocations = this.allocations.map((r) =>
      r.allocation.lineId === lineId && r.supersededAt === null ? { ...r, supersededAt: at } : r,
    );
    for (const value of values)
      this.allocations.push({ allocation: { lineId, ...value }, setAt: at, supersededAt: null });
  }

  /** PlanStatusRepository, like DrizzleBudgetPlanRepository.setStatus: the version stays. */
  async setStatus(planId: string, status: PlanStatus): Promise<void> {
    this.plans = this.plans.map((p) => (p.id === planId ? { ...p, status } : p));
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

  /** Writes to a line's parts are scoped to its plan: a line of another plan, or a removed one, is not found. */
  private hasCurrentLine(planId: string, lineId: string): boolean {
    return this.lines.some((r) => r.line.id === lineId && r.line.planId === planId && r.deletedAt === null);
  }

  private mergeCapacities(planId: string, capacities: readonly MemberCapacity[]): void {
    const kept = (this.capacities.get(planId) ?? []).filter(
      (c) => !capacities.some((n) => n.memberId === c.memberId),
    );
    this.capacities.set(planId, [...kept, ...capacities]);
  }
}
