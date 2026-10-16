import { POST as archiveSpaceRoute } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { GET as pendingRoute } from "@/app/api/v1/spaces/[spaceId]/pending-occurrences/route";
import { POST as confirmRoute } from "@/app/api/v1/spaces/[spaceId]/pending-occurrences/[occurrenceId]/confirm/route";
import { POST as skipRoute } from "@/app/api/v1/spaces/[spaceId]/pending-occurrences/[occurrenceId]/skip/route";
import { GET as listTransactionsRoute } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import {
  POST as defineRecurrenceRoute,
  GET as listRecurrencesRoute,
} from "@/app/api/v1/spaces/[spaceId]/recurrences/route";
import {
  GET as getRecurrenceRoute,
  PATCH as patchRecurrenceRoute,
} from "@/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/route";
import { GET as upcomingRoute } from "@/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/occurrences/route";
import { POST as endRoute } from "@/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/end/route";
import { POST as pauseRoute } from "@/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/pause/route";
import { POST as resumeRoute } from "@/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/resume/route";
import { FixedClock } from "@/shared/kernel";
import { call, type TestUser } from "./app";
import {
  activatePlan,
  addLine,
  lineNamed,
  newPlan,
  putAllocation,
  putCategories,
  setCapacities,
} from "./budgeting";
import {
  categoryWithKey,
  cop,
  household,
  newAccount,
  type Household,
  type MoneyDto,
  type TransactionDto,
} from "./ledger";

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

/** HU-E4-11: the space's recurrences as `user` reads them. */
export const listRecurrences = (user: TestUser, spaceId: string) =>
  call(listRecurrencesRoute, "GET", recurrencesPath(spaceId), { user, params: { spaceId } });

export const getRecurrence = (user: TestUser, spaceId: string, recurrenceId: string) =>
  call(getRecurrenceRoute, "GET", recurrencesPath(spaceId, `/${recurrenceId}`), {
    user,
    params: { spaceId, recurrenceId },
  });

/** The recurrence as `user` reads it; throws unless 200. */
export const recurrenceOf = async (
  user: TestUser,
  spaceId: string,
  recurrenceId: string,
): Promise<RecurrenceDto> => {
  const response = await getRecurrence(user, spaceId, recurrenceId);
  if (response.status !== 200) throw new Error(`recurrence read failed with status ${response.status}`);
  return (await response.json()) as RecurrenceDto;
};

/** HU-E4-11: its next `count` dates (`GET …/occurrences?count=<count>`; the default when absent). */
export const upcoming = (user: TestUser, spaceId: string, recurrenceId: string, count?: string) =>
  call(
    upcomingRoute,
    "GET",
    recurrencesPath(spaceId, `/${recurrenceId}/occurrences${count === undefined ? "" : `?count=${count}`}`),
    { user, params: { spaceId, recurrenceId } },
  );

/** HU-E4-11: `user` changes the recurrence; `body` names only what changes. */
export const patchRecurrence = (user: TestUser, spaceId: string, recurrenceId: string, body: unknown) =>
  call(patchRecurrenceRoute, "PATCH", recurrencesPath(spaceId, `/${recurrenceId}`), {
    user,
    params: { spaceId, recurrenceId },
    body,
  });

const move =
  (route: typeof pauseRoute, name: string) => (user: TestUser, spaceId: string, recurrenceId: string) =>
    call(route, "POST", recurrencesPath(spaceId, `/${recurrenceId}/${name}`), {
      user,
      params: { spaceId, recurrenceId },
    });

/** HU-E4-11: `user` pauses, resumes or ends the recurrence. */
export const pauseRecurrence = move(pauseRoute, "pause");
export const resumeRecurrence = move(resumeRoute, "resume");
export const endRecurrence = move(endRoute, "end");

/**
 * The recurrences a test defines and ends. The scheduler's job handles every active recurrence of the database, so a
 * suite that defines recurrences ends them (logically, D8) after each test, or a later run, of its own file or of
 * another, finds them due. `endAll` ends every one of them, even if ending one fails, and then throws once with all
 * the failures; it forgets them only after trying them all.
 */
export const trackedRecurrences = () => {
  const defines: { user: TestUser; spaceId: string; id: string }[] = [];
  const endedOrThrow = async ({ user, spaceId, id }: (typeof defines)[number]) => {
    // One that ran out of dates is ENDED already, and a move of an ENDED recurrence is refused.
    if ((await recurrenceOf(user, spaceId, id)).status !== "ENDED") {
      const ended = await endRecurrence(user, spaceId, id);
      if (ended.status !== 200) throw new Error(`ending ${id} failed with status ${ended.status}`);
    }
    const { status } = await recurrenceOf(user, spaceId, id);
    if (status !== "ENDED") throw new Error(`${id} is ${status} after it was ended`);
  };
  return {
    /** Defines the recurrence as `user` (throws unless 201) and remembers it. */
    define: async (...[user, spaceId, body, headers]: Parameters<typeof postRecurrence>) => {
      const recurrence = await defined(user, spaceId, body, headers);
      defines.push({ user, spaceId, id: recurrence.id });
      return recurrence;
    },
    /** Remembers a recurrence defined otherwise, for `user` to end: one whose definer leaves, for instance. */
    track: (user: TestUser, spaceId: string, id: string): void => void defines.push({ user, spaceId, id }),
    /** The ids of the recurrences defined since the last `endAll`. */
    ids: (): string[] => defines.map((d) => d.id),
    endAll: async (): Promise<void> => {
      const failures: unknown[] = [];
      for (const recurrence of defines) {
        try {
          await endedOrThrow(recurrence);
        } catch (error: unknown) {
          failures.push(error);
        }
      }
      const attempted = defines.splice(0).length;
      if (failures.length > 0)
        throw new AggregateError(failures, `${failures.length} of ${attempted} recurrences were not ended`);
    },
  };
};

/** HU-E4-05: the space's transactions of `period` ("2026-12") as `user` lists them, newest first. */
export const transactionsIn = async (
  user: TestUser,
  spaceId: string,
  period: string,
): Promise<TransactionDto[]> => {
  const response = await call(
    listTransactionsRoute,
    "GET",
    `/api/v1/spaces/${spaceId}/transactions?period=${encodeURIComponent(period)}`,
    { user, params: { spaceId } },
  );
  if (response.status !== 200) throw new Error(`listing failed with status ${response.status}`);
  return ((await response.json()) as { items: TransactionDto[] }).items;
};

/**
 * Household's ACTIVE plan for `period`: capacities Ana 1,600,000 and Juan 2,400,000 COP and the line Home (1,470,000
 * COP, PROPORTIONAL, so 40 % / 60 %, unless `percent` allocates it) consuming Utilities. Returns the plan id.
 */
export const homePlan = async (
  h: HouseholdWithFund,
  period: string,
  percent?: readonly [string, string],
): Promise<string> => {
  const succeeded = async (response: Promise<Response>) => {
    const answer = await response;
    if (answer.status !== 200) throw new Error(`plan setup failed with status ${answer.status}`);
  };
  const { id } = await newPlan(h.ana, h.spaceId, period);
  await setCapacities(h.ana, h.spaceId, id, [
    [h.ana.memberId, 1_600_000],
    [h.juan.memberId, 2_400_000],
  ]);
  const plan = await addLine(h.ana, h.spaceId, id, {
    name: "Home",
    pesos: 1_470_000,
    funding: "DIRECT",
    rolloverMode: "RESET",
  });
  const home = lineNamed(plan, "Home").id;
  await succeeded(putCategories(h.ana, h.spaceId, id, home, [h.utilities]));
  if (percent !== undefined) {
    const members = [
      { memberId: h.ana.memberId, percent: percent[0] },
      { memberId: h.juan.memberId, percent: percent[1] },
    ];
    await succeeded(putAllocation(h.ana, h.spaceId, id, home, { rule: "PERCENT", members }));
  }
  await succeeded(activatePlan(h.ana, h.spaceId, id));
  return id;
};

const pendingPath = (spaceId: string, rest = "") => `/api/v1/spaces/${spaceId}/pending-occurrences${rest}`;

/** HU-E4-13: the space's pending occurrences as `user` lists them. */
export const pendingIn = (user: TestUser, spaceId: string) =>
  call(pendingRoute, "GET", pendingPath(spaceId), { user, params: { spaceId } });

export const pendingOf = async (user: TestUser, spaceId: string): Promise<OccurrenceDto[]> => {
  const response = await pendingIn(user, spaceId);
  if (response.status !== 200) throw new Error(`pending list failed with status ${response.status}`);
  return ((await response.json()) as { items: OccurrenceDto[] }).items;
};

/** HU-E4-13: `user` skips the pending occurrence. */
export const skipOccurrence = (user: TestUser, spaceId: string, occurrenceId: string) =>
  call(skipRoute, "POST", pendingPath(spaceId, `/${occurrenceId}/skip`), {
    user,
    params: { spaceId, occurrenceId },
  });

/** HU-E4-13: `user` confirms the pending occurrence with `body` (`{ amount, date? }`). */
export const confirmOccurrence = (
  user: TestUser,
  spaceId: string,
  occurrenceId: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  call(confirmRoute, "POST", pendingPath(spaceId, `/${occurrenceId}/confirm`), {
    user,
    params: { spaceId, occurrenceId },
    body,
    headers,
  });
