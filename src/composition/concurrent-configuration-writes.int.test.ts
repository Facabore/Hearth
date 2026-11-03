import { afterAll, describe, expect, it } from "vitest";
import { createCreateAccount } from "@/modules/accounts/application";
import { DrizzleAccountRepository } from "@/modules/accounts/infrastructure/drizzle-account-repository";
import {
  createAddBudgetLine,
  createCreateBudgetPlan,
  createMapCategoriesToLine,
  type BudgetingDeps,
} from "@/modules/budgeting/application";
import { DrizzleBudgetPlanRepository } from "@/modules/budgeting/infrastructure/drizzle-budget-plan-repository";
import { createDeleteCategory } from "@/modules/categories/application";
import { DrizzleCategoryRepository } from "@/modules/categories/infrastructure/drizzle-category-repository";
import { createRecordExpense, type LedgerDeps } from "@/modules/ledger/application";
import { DrizzleAuditLog } from "@/modules/ledger/infrastructure/drizzle-audit-log";
import { DrizzleLedgerQueries } from "@/modules/ledger/infrastructure/drizzle-ledger-queries";
import { DrizzleRecurrenceRepository } from "@/modules/ledger/infrastructure/drizzle-recurrence-repository";
import { DrizzleTransactionRepository } from "@/modules/ledger/infrastructure/drizzle-transaction-repository";
import { createSpaceAccess, createUpdateSpaceSettings } from "@/modules/spaces/application";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { FixedClock } from "@/shared/kernel";
import { testDatabase } from "../../tests/support/database";
import { fixedTimeZones, money, unwrap } from "../../tests/support/fakes";
import { categoryFixture, sharedLedgerFixture } from "../../tests/support/fixtures";
import { outcomesOf } from "../../tests/support/locks";
import { budgetCategoriesOf, categoryUsageOf, ledgerCategoriesOf, spaceUsageOf } from "./container";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const spaces = new DrizzleSpaceRepository(tm);
const accounts = new DrizzleAccountRepository(tm);
const categories = new DrizzleCategoryRepository(tm);
const plans = new DrizzleBudgetPlanRepository(tm);
const ledgerQueries = new DrizzleLedgerQueries(tm);
const access = createSpaceAccess(spaces);
const ids = new UuidV7IdGenerator();
const clock = new FixedClock(new Date("2026-11-02T17:00:00Z"));

afterAll(() => pool.end());

// Every writer of #245 bound as the composition root binds it, over PostgreSQL.
const ledgerDeps: LedgerDeps = {
  access,
  members: spaces,
  spaceLocks: spaces,
  transactions: new DrizzleTransactionRepository(tm),
  query: ledgerQueries,
  audit: new DrizzleAuditLog(tm),
  accounts: {
    find: async (accountId) => {
      const account = await accounts.findById(accountId);
      return account
        ? {
            id: account.id,
            spaceId: account.spaceId,
            ownerUserId: account.ownerUserId,
            isSharedFund: account.type === "SHARED_FUND",
            archived: account.archivedAt !== null,
          }
        : null;
    },
  },
  accountBalances: { balanceOf: async () => 0n },
  categories: ledgerCategoriesOf(categories),
  closedPeriods: { isClosed: async () => false },
  defaultSplits: { allocationWeights: async () => null },
  storedPeriods: async () => [],
  ids,
  clock,
  timeZone: "America/Bogota",
  userTimeZones: fixedTimeZones(),
  tm,
};
const budgetingDeps: BudgetingDeps = {
  access,
  spaceLocks: spaces,
  members: spaces,
  plans,
  spending: { expensesByCategory: async () => [], transfersIntoAccounts: async () => [] },
  savingsAccounts: { find: async () => null },
  categories: budgetCategoriesOf(categories),
  ids,
  clock,
  tm,
};
const recordExpense = createRecordExpense(ledgerDeps);
const createPlan = createCreateBudgetPlan(budgetingDeps);
const mapCategories = createMapCategoriesToLine({ ...budgetingDeps, mappings: plans });
const deleteCategory = createDeleteCategory({
  categories,
  access,
  ids,
  clock,
  tm,
  usage: categoryUsageOf(ledgerQueries, plans),
});
const updateSettings = createUpdateSpaceSettings({
  spaces,
  spaceLocks: spaces,
  access,
  usage: spaceUsageOf({
    accounts,
    recurrences: new DrizzleRecurrenceRepository(tm),
    ledger: ledgerQueries,
    plans,
  }),
  tm,
});
const createAccount = createCreateAccount({
  accounts,
  access,
  spaceLocks: spaces,
  movements: ledgerQueries,
  ids,
  clock,
  userTimeZones: fixedTimeZones(),
  tm,
});

describe("the writers of #245 running at once", () => {
  it("all complete, none deadlocked, over five rounds of eight concurrent transactions", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const ana = { spaceId: w.household.spaceId, userId: w.household.userId };
    const utilities = await categoryFixture(db, w.household, "Utilities");
    const { plan } = unwrap(await createPlan({ ...ana, period: "2026-11" }));
    await plans.setCapacities(
      plan.id,
      [{ memberId: w.household.memberId, amount: 100_000_000n }],
      clock.now(),
    );
    unwrap(
      await createAddBudgetLine({ ...budgetingDeps, lines: plans })({
        ...ana,
        planId: plan.id,
        expectedVersion: null,
        line: { name: "Home", plannedAmount: money(50_000_000n) },
      }),
    );
    const [home] = (await plans.contents(plan.id)).lines;
    for (let round = 1; round <= 5; round++) {
      const old = await categoryFixture(db, w.household, `Old ${round}`);
      const expense = () =>
        recordExpense({ ...ana, amount: money(1_000_000n), categoryId: w.groceries, accountId: w.bank });
      const outcomes = await outcomesOf(
        expense(),
        expense(),
        expense(),
        updateSettings({ ...ana, changes: { name: `Household ${round}` } }),
        createAccount({
          spaceId: w.personal.spaceId,
          userId: w.personal.userId,
          name: `Wallet ${round}`,
          type: "WALLET",
          openingBalance: money(500_000n),
        }),
        createPlan({ ...ana, period: `2027-0${round}` }),
        mapCategories({
          ...ana,
          planId: plan.id,
          lineId: home!.id,
          expectedVersion: null,
          categoryIds: [utilities],
        }),
        deleteCategory({ ...ana, categoryId: old }),
      );
      expect(outcomes, `round ${round}`).toEqual(Array(8).fill("ok"));
    }
  });
});
