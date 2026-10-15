import type {
  BudgetAccount,
  BudgetCategories,
  BudgetingDeps,
  PlanSpending,
  PreviousIncome,
  SavingsAccountReader,
} from "@/modules/budgeting/application";
import {
  createSpaceAccess,
  type SpaceId,
  type SpaceMember,
  type SpaceMemberId,
} from "@/modules/spaces/application";
import { createPersonalSpace } from "@/modules/spaces/domain/space";
import { FixedClock, type LocalDate, type PeriodPolicy } from "@/shared/kernel";
import { memoryTm, sequentialIds } from "./fakes";
import { InMemoryBudgetPlans } from "./in-memory-budgeting";
import { householdSpace, InMemorySpaceStore, memberOf } from "./in-memory-spaces";

export const HOUSEHOLD = "space-household";
export const NOW = new Date("2026-10-14T12:00:00Z");

/** HU-E6 Background, in join order: OWNER Ana, MEMBER Juan, VIEWER Sofi and the guest Pedro. */
export const BUDGET_MEMBERS: readonly SpaceMember[] = [
  memberOf("Ana", "OWNER", 0),
  memberOf("Juan", "MEMBER", 1),
  memberOf("Sofi", "VIEWER", 2),
  memberOf("Pedro", null, 3),
];

/** PlanSpending over fixed sums, as the ledger would return them for the plan's period; records what was asked. */
export class FixedSpending implements PlanSpending {
  byCategory: { categoryId: string; amount: bigint }[] = [];
  byAccount: { accountId: string; amount: bigint }[] = [];
  readonly asked: { spaceId: string; from: LocalDate; to: LocalDate }[] = [];

  async expensesByCategory(spaceId: string, from: LocalDate, to: LocalDate) {
    this.asked.push({ spaceId, from, to });
    return [...this.byCategory];
  }

  async transfersIntoAccounts(accountIds: readonly string[]) {
    return this.byAccount.filter((a) => accountIds.includes(a.accountId));
  }
}

const personal = (name: string, key: string) =>
  createPersonalSpace({
    id: `space-${key}` as SpaceId,
    memberId: `member-${key}-personal` as SpaceMemberId,
    ownerUserId: `u-${key}`,
    ownerName: name,
    now: NOW,
  });

/**
 * Household (`space-household`, COP) with the HU-E6 Background members unless given, Ana's and Marta's personal
 * spaces, in-memory plans and fixed spending. Use-case tests add their own ports to `deps`.
 */
export const budgetingWorld = (
  options: { readonly members?: readonly SpaceMember[]; readonly periodPolicy?: PeriodPolicy } = {},
) => {
  const spaces = new InMemorySpaceStore();
  spaces.seed({
    ...householdSpace(options.members ?? BUDGET_MEMBERS),
    periodPolicy: options.periodPolicy ?? { kind: "MONTHLY", day: 1 },
  });
  spaces.seed(personal("Ana", "ana"));
  spaces.seed(personal("Marta", "marta"));
  const plans = new InMemoryBudgetPlans();
  const spending = new FixedSpending();
  const deps: BudgetingDeps = {
    access: createSpaceAccess(spaces),
    members: spaces,
    plans,
    spending,
    ids: sequentialIds("budget"),
    clock: new FixedClock(NOW),
    tm: memoryTm,
  };
  return { spaces, plans, spending, deps };
};

/** D17 PreviousIncome over fixed personal-space incomes per user (COP unless given); records who was asked. */
export const fixedIncome = (byUser: Readonly<Record<string, bigint>>, currency = "COP") => {
  const asked: { userId: string; from: LocalDate; to: LocalDate }[] = [];
  const previousIncome: PreviousIncome = async (userId, from, to) => {
    asked.push({ userId, from, to });
    return { amount: byUser[userId] ?? 0n, currency };
  };
  return { previousIncome, asked };
};

/** HU-E6-03 accounts: Ana's savings account, her archived one and her BANK account; Juan's and Marta's savings. */
export const ACCOUNTS: readonly BudgetAccount[] = [
  { id: "acc-savings", ownerUserId: "u-ana", isSavings: true, archived: false },
  { id: "acc-old-savings", ownerUserId: "u-ana", isSavings: true, archived: true },
  { id: "acc-bank", ownerUserId: "u-ana", isSavings: false, archived: false },
  { id: "acc-juan-savings", ownerUserId: "u-juan", isSavings: true, archived: false },
  { id: "acc-marta-savings", ownerUserId: "u-marta", isSavings: true, archived: false },
];

export const savingsAccounts: SavingsAccountReader = {
  find: async (accountId) => ACCOUNTS.find((a) => a.id === accountId) ?? null,
};

/** HU-E6-04: Household's live categories (`cat-old` archived); every other space has only `cat-personal`. */
export const householdCategories: BudgetCategories = {
  list: async (spaceId) =>
    spaceId === HOUSEHOLD
      ? [
          { id: "cat-groceries", archived: false },
          { id: "cat-utilities", archived: false },
          { id: "cat-outings", archived: false },
          { id: "cat-restaurants", archived: false },
          { id: "cat-old", archived: true },
        ]
      : [{ id: "cat-personal", archived: false }],
};
