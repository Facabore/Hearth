import { POST as archiveSpaceRoute } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { POST as defineRecurrenceRoute } from "@/app/api/v1/spaces/[spaceId]/recurrences/route";
import { FixedClock } from "@/shared/kernel";
import { call, type TestUser } from "./app";
import { categoryWithKey, cop, household, newAccount, type Household, type MoneyDto } from "./ledger";

/**
 * The clock of the M3-C acceptance files that close no plan: recurrences are defined on 2026-10-28 in Bogotá
 * whatever day the suite runs, so their first dates never move (ruling P24).
 */
export const DEFINITION_DAY_CLOCK = new FixedClock(new Date("2026-10-28T17:00:00Z"));

export interface OccurrenceDto {
  id: string;
  recurrenceId: string;
  type: string;
  description: string;
  date: string;
  status: string;
  amount: MoneyDto;
  categoryId: string | null;
  transactionId: string | null;
  reason: string | null;
}
export interface RecurrenceDto {
  id: string;
  type: string;
  description: string;
  amount: MoneyDto;
  mode: string;
  schedule: Record<string, unknown>;
  startDate: string;
  endDate: string | null;
  status: string;
  pauseReason: string | null;
  nextOccurrence: string | null;
  categoryId: string | null;
  payerMemberId: string | null;
  sourceAccountId: string | null;
  destinationAccountId: string | null;
  split: unknown;
  lastOccurrence: {
    id: string;
    date: string;
    status: string;
    amount: MoneyDto;
    transactionId: string | null;
    reason: string | null;
  } | null;
  createdBy: string;
  createdAt: string;
}

export const recurrencesPath = (spaceId: string, rest = "") => `/api/v1/spaces/${spaceId}/recurrences${rest}`;

/** HU-E4-11 Background: Household with its "Household Fund" and its seeded Rent and Utilities categories. */
export interface HouseholdWithFund extends Household {
  readonly fund: string;
  readonly rent: string;
  readonly utilities: string;
}

export const householdWithFund = async (): Promise<HouseholdWithFund> => {
  const h = await household();
  return {
    ...h,
    fund: await newAccount(h.ana, "Household Fund", 0, "SHARED_FUND"),
    rent: await categoryWithKey(h.ana, "rent"),
    utilities: await categoryWithKey(h.ana, "utilities"),
  };
};

/** HU-E4-11: "Rent", 1,200,000 COP in Rent paid from the Household Fund, MONTHLY(1), AUTO, from 2026-12-01. */
export const rentBody = (h: HouseholdWithFund, overrides: Record<string, unknown> = {}) => ({
  description: "Rent",
  amount: cop(1_200_000),
  template: { type: "EXPENSE", categoryId: h.rent, payer: { memberId: null, accountId: h.fund } },
  schedule: { kind: "MONTHLY", day: 1 },
  mode: "AUTO",
  startDate: "2026-12-01",
  ...overrides,
});

/** HU-E4-11: `user` defines a recurrence of `spaceId`. */
export const postRecurrence = (
  user: TestUser,
  spaceId: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  call(defineRecurrenceRoute, "POST", recurrencesPath(spaceId), { user, params: { spaceId }, body, headers });

/** Defines the recurrence; throws unless 201. */
export const defined = async (...args: Parameters<typeof postRecurrence>): Promise<RecurrenceDto> => {
  const response = await postRecurrence(...args);
  if (response.status !== 201) throw new Error(`recurrence definition failed with status ${response.status}`);
  return (await response.json()) as RecurrenceDto;
};

/** HU-E1-09: Ana archives the household. */
export const archiveHousehold = async (h: Household): Promise<void> => {
  const response = await call(archiveSpaceRoute, "POST", `/api/v1/spaces/${h.spaceId}/archive`, {
    user: h.ana,
    params: { spaceId: h.spaceId },
  });
  if (response.status !== 204) throw new Error(`archiving failed with status ${response.status}`);
};
