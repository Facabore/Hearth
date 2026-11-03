import { afterAll, describe, expect, it } from "vitest";
import { DrizzleAccountRepository } from "@/modules/accounts/infrastructure/drizzle-account-repository";
import { createCreateBudgetPlan, type BudgetingDeps } from "@/modules/budgeting/application";
import { DrizzleBudgetPlanRepository } from "@/modules/budgeting/infrastructure/drizzle-budget-plan-repository";
import { DrizzleLedgerQueries } from "@/modules/ledger/infrastructure/drizzle-ledger-queries";
import { DrizzleRecurrenceRepository } from "@/modules/ledger/infrastructure/drizzle-recurrence-repository";
import {
  createSpaceAccess,
  createUpdateSpaceSettings,
  type SpaceSettingsChanges,
} from "@/modules/spaces/application";
import type { Space } from "@/modules/spaces/domain/space";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { FixedClock } from "@/shared/kernel";
import { testDatabase } from "../../tests/support/database";
import { sharedSpaceFixture, userFixture } from "../../tests/support/fixtures";
import { heldBy, holder, outcomesOf } from "../../tests/support/locks";
import { spaceUsageOf } from "./container";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const spaces = new DrizzleSpaceRepository(tm);
const plans = new DrizzleBudgetPlanRepository(tm);
const clock = new FixedClock(new Date("2026-11-02T17:00:00Z"));

afterAll(() => pool.end());

type Holder = ReturnType<typeof holder>;

/** The real repository, but a new plan stops in `h.hold()` once it is inserted. */
class HoldingAdd extends DrizzleBudgetPlanRepository {
  constructor(private readonly h: Holder) {
    super(tm);
  }

  override async add(...args: Parameters<DrizzleBudgetPlanRepository["add"]>): Promise<boolean> {
    const added = await super.add(...args);
    await this.h.hold();
    return added;
  }
}

/** The plans' deps over PostgreSQL as the composition root builds them; a test may hold `plans`. */
const budgetingDeps = (repository: DrizzleBudgetPlanRepository = plans): BudgetingDeps => ({
  access: createSpaceAccess(spaces),
  spaceLocks: spaces,
  members: spaces,
  plans: repository,
  spending: { expensesByCategory: async () => [], transfersIntoAccounts: async () => [] },
  savingsAccounts: { find: async () => null },
  categories: { lockForReference: async () => undefined, list: async () => [] },
  ids: new UuidV7IdGenerator(),
  clock,
  tm,
});

/** The settings as the composition root builds them; the write stops in `h.hold()` once the settings are stored. */
const changeSettings = (space: Space, userId: string, changes: SpaceSettingsChanges, h?: Holder) =>
  createUpdateSpaceSettings({
    spaces: {
      findMembership: (spaceId, user) => spaces.findMembership(spaceId, user),
      updateSettings: async (spaceId, settings) => {
        await spaces.updateSettings(spaceId, settings);
        await h?.hold();
      },
    },
    spaceLocks: spaces,
    access: createSpaceAccess(spaces),
    usage: spaceUsageOf({
      accounts: new DrizzleAccountRepository(tm),
      recurrences: new DrizzleRecurrenceRepository(tm),
      ledger: new DrizzleLedgerQueries(tm),
      plans,
    }),
    tm,
  })({ spaceId: space.id, userId, changes });

const createPlan = (space: Space, userId: string, deps = budgetingDeps()) =>
  createCreateBudgetPlan(deps)({ spaceId: space.id, userId, period: "2026-11" });

const household = async () => {
  const ana = await userFixture(pool, "Ana");
  return { ana, space: await sharedSpaceFixture(db, ana.id) };
};

const storedPlansOf = async (spaceId: string) =>
  (
    await pool.query(
      "SELECT start_date::text AS start, end_date::text AS end FROM budget_plans WHERE space_id = $1",
      [spaceId],
    )
  ).rows;

const currencyOf = async (spaceId: string): Promise<string> =>
  (await pool.query("SELECT currency FROM spaces WHERE id = $1", [spaceId])).rows[0].currency as string;

describe("creating a plan against a settings change (#245, M3A-6)", () => {
  it("stores the period of the policy a settings change in progress commits", async () => {
    const { ana, space } = await household();
    const h = holder(tm, pool);
    // MONTHLY(1) becomes MONTHLY(25): "2026-11" runs from 25 October to 24 November.
    const changing = changeSettings(space, ana.id, { periodPolicy: { kind: "MONTHLY", day: 25 } }, h);
    await heldBy(h, changing);
    const creating = createPlan(space, ana.id).finally(h.release);
    expect(await outcomesOf(changing, creating)).toEqual(["ok", "ok"]);
    expect(await storedPlansOf(space.id)).toEqual([{ start: "2026-10-25", end: "2026-11-24" }]);
  });

  it("answers SpaceCurrencyLocked to a currency change that waited for a plan to commit", async () => {
    const { ana, space } = await household();
    const h = holder(tm, pool);
    const creating = createPlan(space, ana.id, budgetingDeps(new HoldingAdd(h)));
    await heldBy(h, creating);
    const changing = changeSettings(space, ana.id, { currency: "USD" }).finally(h.release);
    expect(await outcomesOf(creating, changing)).toEqual(["SpaceCurrencyLocked", "ok"]);
    expect(await currencyOf(space.id)).toBe("COP");
    expect(await storedPlansOf(space.id)).toEqual([{ start: "2026-11-01", end: "2026-11-30" }]);
  });
});
