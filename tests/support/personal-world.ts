import type { PersonalDeps, PersonalSums } from "@/modules/reporting/application";
import type { MemberPlace, SpaceId, SpaceMemberId } from "@/modules/spaces/application";
import type { LocalDate } from "@/shared/kernel";
import { InMemoryBudgetPlans } from "./in-memory-budgeting";

const NOTHING_PAID = {
  payments: 0n,
  paymentsOutsideTheApp: 0n,
  fundContributions: 0n,
  contributionsOutsideTheApp: 0n,
};

/** One user's sums per period, keyed by the first day asked for, as the ledger sums them; records every question. */
export class PersonalSumsByPeriod implements PersonalSums {
  readonly consumption: Record<string, { spaceId: string; categoryId: string; amount: bigint }[]> = {};
  readonly paidOut: Record<string, typeof NOTHING_PAID> = {};
  readonly asked: { memberIds: readonly string[]; from: LocalDate; to: LocalDate }[] = [];

  async consumptionByCategory(memberIds: readonly string[], from: LocalDate, to: LocalDate) {
    this.asked.push({ memberIds, from, to });
    return [...(this.consumption[from] ?? [])];
  }

  async cashOut(memberIds: readonly string[], from: LocalDate, to: LocalDate) {
    this.asked.push({ memberIds, from, to });
    return this.paidOut[from] ?? NOTHING_PAID;
  }
}

/** A member row of Ana: a shared COP space with MONTHLY(1) unless told otherwise. */
export const place = (
  spaceId: string,
  memberId: string,
  spaceName: string,
  overrides: Partial<MemberPlace> = {},
): MemberPlace => ({
  memberId: memberId as SpaceMemberId,
  spaceId: spaceId as SpaceId,
  spaceName,
  spaceKind: "SHARED",
  currency: "COP",
  periodPolicy: { kind: "MONTHLY", day: 1 },
  ...overrides,
});

/** HU-E7-04 Background: Ana's personal space, MONTHLY(1), and Household, MONTHLY(25). */
export const ANA_PLACES: readonly MemberPlace[] = [
  place("space-ana", "member-ana-personal", "Personal", { spaceKind: "PERSONAL" }),
  place("space-household", "member-ana", "Household", { periodPolicy: { kind: "MONTHLY", day: 25 } }),
];

/**
 * Ana (`u-ana`) with `places`, the categories of her personal space and of Household (seeded ones with catalog keys,
 * one custom "Pets" in each, a subcategory in each), her savings account `acc-savings`, in-memory plans and the
 * ledger's sums per period.
 */
export const personalWorld = (places: readonly MemberPlace[] = ANA_PLACES) => {
  const plans = new InMemoryBudgetPlans();
  const sums = new PersonalSumsByPeriod();
  /** Transfers keyed by the first day asked for; one with `on` counts only when that date is within the range asked. */
  const transfers: Record<string, { accountId: string; amount: bigint; on?: LocalDate }[]> = {};
  const transfersAsked: { accountIds: readonly string[]; from: LocalDate; to: LocalDate }[] = [];
  const category = (
    id: string,
    key: string | null,
    name: string,
    parentCategoryId: string | null = null,
  ) => ({
    id,
    key,
    name,
    parentCategoryId,
  });
  const categories: Record<string, ReturnType<typeof category>[]> = {
    "space-ana": [
      category("cat-ana-groceries", "groceries", "Groceries"),
      category("cat-ana-restaurants", "restaurants", "Restaurants"),
      category("cat-ana-pets", null, "Pets"),
      // HU-E3-04: a subcategory of her Groceries.
      category("cat-ana-verduras", null, "Verduras", "cat-ana-groceries"),
    ],
    "space-household": [
      category("cat-groceries", "groceries", "Mercado"),
      category("cat-rent", "rent", "Rent"),
      category("cat-pets", null, "Pets"),
      category("cat-vet", null, "Vet", "cat-pets"),
    ],
  };
  const deps: PersonalDeps = {
    places: { placesOf: async (userId) => (userId === "u-ana" ? [...places] : []) },
    plans,
    sums,
    catalog: { listCategories: async (spaceId) => categories[spaceId] ?? [] },
    spending: {
      transfersIntoAccounts: async (accountIds, from, to) => {
        transfersAsked.push({ accountIds, from, to });
        return (transfers[from] ?? [])
          .filter((t) => accountIds.includes(t.accountId))
          .filter((t) => t.on === undefined || (t.on >= from && t.on <= to));
      },
    },
    savingsAccountsOf: async (userId) => (userId === "u-ana" ? ["acc-savings"] : []),
  };
  return { plans, sums, transfers, transfersAsked, deps };
};
