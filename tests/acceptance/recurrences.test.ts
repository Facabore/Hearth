import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as leaveSpace } from "@/app/api/v1/spaces/[spaceId]/leave/route";
import { PATCH as changeMemberRole } from "@/app/api/v1/spaces/[spaceId]/members/[memberId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import type { LocalDate } from "@/shared/kernel";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { cop, joinHousehold } from "../support/ledger";
import {
  archiveHousehold,
  DEFINITION_DAY_CLOCK,
  defined,
  endRecurrence,
  getRecurrence,
  householdWithFund,
  type HouseholdWithFund,
  listRecurrences,
  patchRecurrence,
  pauseRecurrence,
  postRecurrence,
  recurrenceOf,
  rentBody,
  resumeRecurrence,
  upcoming,
  type RecurrenceDto,
} from "../support/recurrences";

let app: Container;
beforeAll(() => {
  app = startTestApp({ clock: DEFINITION_DAY_CLOCK });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

describe("defining a recurrence (HU-E4-11)", () => {
  it("defines the monthly Rent paid from the shared fund: 201, ACTIVE, next on 2026-12-01", async () => {
    const h = await householdWithFund();
    const response = await postRecurrence(h.ana, h.spaceId, rentBody(h));
    expect(response.status).toBe(201);
    const rent = (await response.json()) as RecurrenceDto;
    expect(response.headers.get("location")).toBe(`/api/v1/spaces/${h.spaceId}/recurrences/${rent.id}`);
    expect(rent).toMatchObject({
      type: "EXPENSE",
      description: "Rent",
      amount: cop(1_200_000),
      mode: "AUTO",
      schedule: { kind: "MONTHLY", day: 1 },
      startDate: "2026-12-01",
      endDate: null,
      status: "ACTIVE",
      pauseReason: null,
      nextOccurrence: "2026-12-01",
      categoryId: h.rent,
      payerMemberId: null,
      sourceAccountId: h.fund,
      destinationAccountId: null,
      split: null,
      lastOccurrence: null,
      createdBy: h.ana.userId,
    });
  });

  it("refuses VIEWERs: Sofi answers 403 InsufficientRole", async () => {
    const h = await householdWithFund();
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    expect(await problemOf(await postRecurrence(sofi, h.spaceId, rentBody(h)))).toEqual([
      403,
      "InsufficientRole",
    ]);
  });

  it("hides the household from a user who is not a member: Luis answers 404 SpaceNotFound", async () => {
    const h = await householdWithFund();
    const luis = await registerUser("Luis");
    expect(await problemOf(await postRecurrence(luis, h.spaceId, rentBody(h)))).toEqual([
      404,
      "SpaceNotFound",
    ]);
  });

  it("lets only Juan define Internet paid from his Davivienda account: Ana answers 422 AccountNotOwned (D9)", async () => {
    const h = await householdWithFund();
    const internet = {
      description: "Internet",
      amount: cop(120_000),
      template: {
        type: "EXPENSE",
        categoryId: h.utilities,
        payer: { memberId: h.juan.memberId, accountId: h.juan.account },
      },
      schedule: { kind: "MONTHLY", day: 5 },
      mode: "AUTO",
      startDate: "2026-12-05",
    };
    expect(await problemOf(await postRecurrence(h.ana, h.spaceId, internet))).toEqual([
      422,
      "AccountNotOwned",
    ]);
    expect((await postRecurrence(h.juan, h.spaceId, internet)).status).toBe(201);
  });

  it("replays an Idempotency-Key with the first answer, body and Location included (spec 7)", async () => {
    const h = await householdWithFund();
    const key = { "idempotency-key": "rent-from-december" };
    const first = await postRecurrence(h.ana, h.spaceId, rentBody(h), key);
    const replay = await postRecurrence(h.ana, h.spaceId, rentBody(h), key);
    expect([first.status, replay.status]).toEqual([201, 201]);
    expect(await replay.json()).toEqual(await first.json());
    expect(replay.headers.get("location")).toBe(first.headers.get("location"));
    expect(
      await problemOf(await postRecurrence(h.ana, h.spaceId, rentBody(h, { description: "Other" }), key)),
    ).toEqual([409, "IdempotencyKeyConflict"]);
  });

  it("answers one 404 AccountNotFound for another household's fund, an unknown fund and a malformed id", async () => {
    const h = await householdWithFund();
    const other = await householdWithFund();
    const paidFrom = (accountId: string) =>
      rentBody(h, {
        template: {
          type: "EXPENSE",
          categoryId: h.rent,
          payer: { memberId: null, accountId },
        },
      });
    expect([
      await problemOf(await postRecurrence(h.ana, h.spaceId, paidFrom(other.fund))),
      await problemOf(await postRecurrence(h.ana, h.spaceId, paidFrom(randomUUID()))),
      await problemOf(await postRecurrence(h.ana, h.spaceId, paidFrom("not-a-uuid"))),
    ]).toEqual([
      [404, "AccountNotFound"],
      [404, "AccountNotFound"],
      [404, "AccountNotFound"],
    ]);
  });

  it("answers 422 for an EXACT split and 422 InvalidPeriodPolicy for SEMI_MONTHLY(16, 1)", async () => {
    const h = await householdWithFund();
    const exactSplit = rentBody(h, {
      template: {
        type: "EXPENSE",
        categoryId: h.rent,
        payer: { memberId: null, accountId: h.fund },
        split: { method: "EXACT", participants: [] },
      },
    });
    const semiMonthly = rentBody(h, { schedule: { kind: "SEMI_MONTHLY", day1: 16, day2: 1 } });
    expect([
      await problemOf(await postRecurrence(h.ana, h.spaceId, exactSplit)),
      await problemOf(await postRecurrence(h.ana, h.spaceId, semiMonthly)),
    ]).toEqual([
      [422, "ValidationFailed"],
      [422, "InvalidPeriodPolicy"],
    ]);
  });

  it("refuses a definition with no schedule date between its start and its end, and an end before the start: 422 InvalidRecurrence", async () => {
    const h = await householdWithFund();
    // MONTHLY(1) has no date from 2026-12-02 through 2026-12-20, while 2026-12-01 is an inclusive end.
    const monthlyFrom = (startDate: string, endDate: string) => rentBody(h, { startDate, endDate });
    expect([
      await problemOf(await postRecurrence(h.ana, h.spaceId, monthlyFrom("2026-12-02", "2026-12-20"))),
      await problemOf(await postRecurrence(h.ana, h.spaceId, monthlyFrom("2026-12-01", "2026-11-30"))),
      (await postRecurrence(h.ana, h.spaceId, monthlyFrom("2026-12-01", "2026-12-01"))).status,
    ]).toEqual([[422, "InvalidRecurrence"], [422, "InvalidRecurrence"], 201]);
  });

  it("refuses definitions in an archived space with 409 SpaceArchived (HU-E1-09)", async () => {
    const h = await householdWithFund();
    await archiveHousehold(h);
    expect(await problemOf(await postRecurrence(h.ana, h.spaceId, rentBody(h)))).toEqual([
      409,
      "SpaceArchived",
    ]);
  });
});

/** An error response without its per-request id: what a client can tell two refusals apart by. */
const problemBodyOf = async (response: Response): Promise<[number, Record<string, unknown>]> => {
  const body = (await response.json()) as Record<string, unknown>;
  return [response.status, Object.fromEntries(Object.entries(body).filter(([key]) => key !== "requestId"))];
};

describe("reading recurrences (HU-E4-11)", () => {
  it("previews MONTHLY(31) from 2027-01-01 as 2027-01-31, 2027-02-28 and 2027-03-31", async () => {
    const h = await householdWithFund();
    const clamped = await defined(
      h.ana,
      h.spaceId,
      rentBody(h, { schedule: { kind: "MONTHLY", day: 31 }, startDate: "2027-01-01" }),
    );
    const response = await upcoming(h.ana, h.spaceId, clamped.id, "3");
    expect([response.status, await response.json()]).toEqual([
      200,
      { dates: ["2027-01-31", "2027-02-28", "2027-03-31"] },
    ]);
  });

  it("lists Cleaning's December 2026 occurrences as 2026-12-01 and 2026-12-16 (SEMI_MONTHLY(1, 16))", async () => {
    const h = await householdWithFund();
    const cleaning = await defined(
      h.ana,
      h.spaceId,
      rentBody(h, {
        description: "Cleaning",
        amount: cop(80_000),
        schedule: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 },
        startDate: "2026-12-01",
      }),
    );
    expect(await (await upcoming(h.ana, h.spaceId, cleaning.id, "2")).json()).toEqual({
      dates: ["2026-12-01", "2026-12-16"],
    });
    expect(
      ((await (await upcoming(h.ana, h.spaceId, cleaning.id)).json()) as { dates: string[] }).dates,
    ).toHaveLength(3);
  });

  it("previews at least 1 and at most 24 dates", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    const sizes: number[] = [];
    for (const count of ["1", "24"]) {
      const response = await upcoming(h.ana, h.spaceId, rent.id, count);
      expect(response.status).toBe(200);
      sizes.push(((await response.json()) as { dates: string[] }).dates.length);
    }
    expect(sizes).toEqual([1, 24]);
  });

  it("lists and reads the space's recurrences for every member, Sofi the VIEWER included", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    const cleaning = await defined(
      h.ana,
      h.spaceId,
      rentBody(h, { description: "Cleaning", amount: cop(80_000) }),
    );
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    const list = await listRecurrences(sofi, h.spaceId);
    expect([list.status, ((await list.json()) as { items: RecurrenceDto[] }).items.map((r) => r.id)]).toEqual(
      [200, [rent.id, cleaning.id]],
    );
    expect(await recurrenceOf(sofi, h.spaceId, rent.id)).toEqual(rent);
    const preview = await upcoming(sofi, h.spaceId, rent.id);
    expect([preview.status, await preview.json()]).toEqual([
      200,
      { dates: ["2026-12-01", "2027-01-01", "2027-02-01"] },
    ]);
  });

  it("lists only its own space's recurrences: a household that defined none reads an empty list", async () => {
    const h = await householdWithFund();
    const other = await householdWithFund();
    await defined(other.ana, other.spaceId, rentBody(other));
    const response = await listRecurrences(h.ana, h.spaceId);
    expect([response.status, await response.json()]).toEqual([200, { items: [] }]);
  });

  it("hides the household from a user who is not a member: Luis answers 404 SpaceNotFound on every read", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    const luis = await registerUser("Luis");
    expect([
      await problemOf(await listRecurrences(luis, h.spaceId)),
      await problemOf(await getRecurrence(luis, h.spaceId, rent.id)),
      await problemOf(await upcoming(luis, h.spaceId, rent.id)),
    ]).toEqual([
      [404, "SpaceNotFound"],
      [404, "SpaceNotFound"],
      [404, "SpaceNotFound"],
    ]);
  });

  it("answers the same 404 RecurrenceNotFound for another space's, an unknown and a malformed id", async () => {
    const h = await householdWithFund();
    const other = await householdWithFund();
    const theirs = await defined(other.ana, other.spaceId, rentBody(other));
    const answers = [
      await problemBodyOf(await getRecurrence(h.ana, h.spaceId, theirs.id)),
      await problemBodyOf(await getRecurrence(h.ana, h.spaceId, randomUUID())),
      await problemBodyOf(await getRecurrence(h.ana, h.spaceId, "not-a-uuid")),
      await problemBodyOf(await upcoming(h.ana, h.spaceId, theirs.id)),
      await problemBodyOf(await upcoming(h.ana, h.spaceId, randomUUID())),
      await problemBodyOf(await upcoming(h.ana, h.spaceId, "not-a-uuid")),
    ];
    expect(answers[0]).toMatchObject([404, { code: "RecurrenceNotFound" }]);
    for (const answer of answers) expect(answer).toEqual(answers[0]);
  });

  it("refuses a count that is not an integer from 1 to 24 with 422 ValidationFailed", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    const counts = ["0", "-1", "25", "1.5", "many", "NaN", "Infinity", "-Infinity", ""];
    const answers: [string, number, string][] = [];
    for (const count of counts) {
      answers.push([count, ...(await problemOf(await upcoming(h.ana, h.spaceId, rent.id, count)))]);
    }
    expect(answers).toEqual(counts.map((count) => [count, 422, "ValidationFailed"]));
  });

  it("still reads the recurrences of an archived space (HU-E1-09)", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    await archiveHousehold(h);
    expect([
      (await listRecurrences(h.ana, h.spaceId)).status,
      (await getRecurrence(h.ana, h.spaceId, rent.id)).status,
      (await upcoming(h.ana, h.spaceId, rent.id)).status,
    ]).toEqual([200, 200, 200]);
  });
});

describe("editing a recurrence (HU-E4-11)", () => {
  const sharesOf = (h: HouseholdWithFund) => ({
    method: "SHARES",
    participants: [
      { memberId: h.ana.memberId, units: 1 },
      { memberId: h.juan.memberId, units: 2 },
    ],
  });
  /** The Rent with a split by share units and an end date: every nullable field set. */
  const splitRentBody = (h: HouseholdWithFund) =>
    rentBody(h, {
      template: {
        type: "EXPENSE",
        categoryId: h.rent,
        payer: { memberId: null, accountId: h.fund },
        split: sharesOf(h),
      },
      endDate: "2027-06-30",
    });
  /** Ana's monthly contribution to the Household Fund from her own account. */
  const contributionBody = (h: HouseholdWithFund) => ({
    ...rentBody(h),
    description: "Fund",
    template: { type: "FUND_CONTRIBUTION", fundAccountId: h.fund, sourceAccountId: h.ana.account },
  });

  it("changes the Rent to 1,300,000 COP and gives it an end, for the occurrences not recorded yet", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    const response = await patchRecurrence(h.ana, h.spaceId, rent.id, {
      amount: cop(1_300_000),
      endDate: "2027-06-30",
    });
    const changed = await recurrenceOf(h.ana, h.spaceId, rent.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(changed);
    expect(changed).toMatchObject({
      amount: cop(1_300_000),
      endDate: "2027-06-30",
      status: "ACTIVE",
      nextOccurrence: "2026-12-01",
    });
  });

  it("keeps the split and the end date a body does not name: renaming the Rent changes only its description", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, splitRentBody(h));
    expect(rent).toMatchObject({ split: sharesOf(h), endDate: "2027-06-30" });
    const response = await patchRecurrence(h.ana, h.spaceId, rent.id, { description: "Rent, renewed" });
    expect(response.status).toBe(200);
    expect(await recurrenceOf(h.ana, h.spaceId, rent.id)).toStrictEqual({
      ...rent,
      description: "Rent, renewed",
    });
  });

  it("removes the end with endDate null and the split with split null, each leaving the other as it was", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, splitRentBody(h));
    expect((await patchRecurrence(h.ana, h.spaceId, rent.id, { endDate: null })).status).toBe(200);
    expect(await recurrenceOf(h.ana, h.spaceId, rent.id)).toStrictEqual({ ...rent, endDate: null });
    expect((await patchRecurrence(h.ana, h.spaceId, rent.id, { split: null })).status).toBe(200);
    expect(await recurrenceOf(h.ana, h.spaceId, rent.id)).toStrictEqual({
      ...rent,
      endDate: null,
      split: null,
    });
  });

  it("renames a fund contribution, which has no split or category to name: 200 and the rest as it was", async () => {
    const h = await householdWithFund();
    const contribution = await defined(h.ana, h.spaceId, contributionBody(h));
    const response = await patchRecurrence(h.ana, h.spaceId, contribution.id, {
      description: "Fund, renewed",
    });
    expect(response.status).toBe(200);
    expect(await recurrenceOf(h.ana, h.spaceId, contribution.id)).toStrictEqual({
      ...contribution,
      description: "Fund, renewed",
    });
  });

  it("splits by share units, then returns to the default split with split null (P23)", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    const shares = sharesOf(h);
    const split = (await (
      await patchRecurrence(h.ana, h.spaceId, rent.id, { split: shares })
    ).json()) as RecurrenceDto;
    expect(split.split).toEqual(shares);
    const reset = (await (
      await patchRecurrence(h.ana, h.spaceId, rent.id, { split: null })
    ).json()) as RecurrenceDto;
    expect(reset.split).toBeNull();
  });

  it("lets only Ana change her Gym, debited from her own account: Luis the ADMIN answers 422 AccountNotOwned (D9)", async () => {
    const h = await householdWithFund();
    const luis = await joinHousehold(h, "Luis", "ADMIN");
    const gym = await defined(h.ana, h.spaceId, {
      description: "Gym",
      amount: cop(90_000),
      template: {
        type: "EXPENSE",
        categoryId: h.utilities,
        payer: { memberId: h.ana.memberId, accountId: h.ana.account },
      },
      schedule: { kind: "MONTHLY", day: 3 },
      mode: "AUTO",
      startDate: "2026-12-03",
    });
    expect([
      await problemOf(await patchRecurrence(luis, h.spaceId, gym.id, { amount: cop(95_000) })),
      await problemOf(await patchRecurrence(luis, h.spaceId, gym.id, { description: "Gym, renewed" })),
      await problemOf(await patchRecurrence(luis, h.spaceId, gym.id, { mode: "CONFIRM" })),
    ]).toEqual([
      [422, "AccountNotOwned"],
      [422, "AccountNotOwned"],
      [422, "AccountNotOwned"],
    ]);
    expect(await recurrenceOf(h.ana, h.spaceId, gym.id)).toEqual(gym);
    expect((await patchRecurrence(h.ana, h.spaceId, gym.id, { amount: cop(95_000) })).status).toBe(200);
  });

  it("lets an ADMIN change the Rent paid from the shared fund, which debits nobody's own account", async () => {
    const h = await householdWithFund();
    const luis = await joinHousehold(h, "Luis", "ADMIN");
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    expect((await patchRecurrence(luis, h.spaceId, rent.id, { amount: cop(1_300_000) })).status).toBe(200);
    expect((await recurrenceOf(h.ana, h.spaceId, rent.id)).amount).toEqual(cop(1_300_000));
  });

  it("refuses a MEMBER who did not define it (403) and lets Juan change the one he defined", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    const water = await defined(h.juan, h.spaceId, rentBody(h, { description: "Water" }));
    expect(
      await problemOf(await patchRecurrence(h.juan, h.spaceId, rent.id, { description: "Juan's rent" })),
    ).toEqual([403, "InsufficientRole"]);
    expect((await recurrenceOf(h.ana, h.spaceId, rent.id)).description).toBe("Rent");
    expect(
      (await patchRecurrence(h.juan, h.spaceId, water.id, { description: "Water and gas" })).status,
    ).toBe(200);
  });

  it("refuses Sofi the VIEWER with 403, a stranger with 404 SpaceNotFound and an archived space with 409 SpaceArchived", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    const luis = await registerUser("Luis");
    const change = { description: "Other" };
    const answers = [
      await problemOf(await patchRecurrence(sofi, h.spaceId, rent.id, change)),
      await problemOf(await patchRecurrence(luis, h.spaceId, rent.id, change)),
    ];
    await archiveHousehold(h);
    answers.push(await problemOf(await patchRecurrence(h.ana, h.spaceId, rent.id, change)));
    expect(answers).toEqual([
      [403, "InsufficientRole"],
      [404, "SpaceNotFound"],
      [409, "SpaceArchived"],
    ]);
    expect(await recurrenceOf(h.ana, h.spaceId, rent.id)).toEqual(rent);
  });

  it("answers the same 404 RecurrenceNotFound for another space's, an unknown and a malformed id", async () => {
    const h = await householdWithFund();
    const other = await householdWithFund();
    const theirs = await defined(other.ana, other.spaceId, rentBody(other));
    const change = { description: "Theirs" };
    const answers = [
      await problemBodyOf(await patchRecurrence(h.ana, h.spaceId, theirs.id, change)),
      await problemBodyOf(await patchRecurrence(h.ana, h.spaceId, randomUUID(), change)),
      await problemBodyOf(await patchRecurrence(h.ana, h.spaceId, "not-a-uuid", change)),
    ];
    expect(answers[0]).toMatchObject([404, { code: "RecurrenceNotFound" }]);
    for (const answer of answers) expect(answer).toEqual(answers[0]);
    expect(await recurrenceOf(other.ana, other.spaceId, theirs.id)).toEqual(theirs);
  });

  it("refuses each key that fixes the type, the payer or an account, naming the field: 422 ValidationFailed", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    const immutable: Record<string, unknown>[] = [
      { template: { type: "INCOME", categoryId: h.rent, accountId: h.ana.account } },
      { type: "INCOME" },
      { payer: { memberId: h.juan.memberId, accountId: h.juan.account } },
      { payerMemberId: h.juan.memberId },
      { payerMemberId: null },
      { accountId: h.ana.account },
      { fundAccountId: h.fund },
      { memberId: h.juan.memberId },
      { sourceAccountId: h.ana.account },
      { destinationAccountId: h.ana.account },
      { startDate: "2026-12-05" },
    ];
    const answers: [string, number, string, string[]][] = [];
    for (const body of immutable) {
      const response = await patchRecurrence(h.ana, h.spaceId, rent.id, body);
      const problem = (await response.json()) as { code: string; errors: { path: string }[] };
      answers.push([
        JSON.stringify(body),
        response.status,
        problem.code,
        problem.errors.map((error) => error.path),
      ]);
    }
    expect(answers).toEqual(
      immutable.map((body) => [JSON.stringify(body), 422, "ValidationFailed", Object.keys(body)]),
    );
    expect(await recurrenceOf(h.ana, h.spaceId, rent.id)).toEqual(rent);
  });

  it("refuses an EXACT split and a null amount or category: 422 ValidationFailed", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    const refused: Record<string, unknown>[] = [
      { split: { method: "EXACT", participants: [] } },
      { amount: null },
      { categoryId: null },
    ];
    const answers: [Record<string, unknown>, number, string][] = [];
    for (const body of refused)
      answers.push([body, ...(await problemOf(await patchRecurrence(h.ana, h.spaceId, rent.id, body)))]);
    expect(answers).toEqual(refused.map((body) => [body, 422, "ValidationFailed"]));
    expect(await recurrenceOf(h.ana, h.spaceId, rent.id)).toEqual(rent);
  });

  it("strips a key it does not know, as every body here does: foo is ignored and the rest applies", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    const response = await patchRecurrence(h.ana, h.spaceId, rent.id, {
      foo: 1,
      description: "Rent, renewed",
    });
    expect(response.status).toBe(200);
    expect(await recurrenceOf(h.ana, h.spaceId, rent.id)).toEqual({ ...rent, description: "Rent, renewed" });
  });

  it("answers the domain's refusals: an end before the start, an empty description, a zero amount, another currency, an unknown currency, a schedule that is not one, another space's category", async () => {
    const h = await householdWithFund();
    const other = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    const contribution = await defined(h.ana, h.spaceId, contributionBody(h));
    const refused: [string, Record<string, unknown>, number, string][] = [
      [rent.id, { endDate: "2026-11-30" }, 422, "InvalidRecurrence"],
      [rent.id, { description: "" }, 422, "InvalidDescription"],
      [rent.id, { amount: cop(0) }, 422, "InvalidAmount"],
      [rent.id, { amount: { amount: "100", currency: "USD" } }, 422, "CurrencyMismatch"],
      [rent.id, { amount: { amount: "100", currency: "XXX" } }, 422, "UnknownCurrency"],
      [rent.id, { schedule: { kind: "MONTHLY", day: 32 } }, 422, "InvalidPeriodPolicy"],
      [rent.id, { schedule: { kind: "SEMI_MONTHLY", day1: 16, day2: 1 } }, 422, "InvalidPeriodPolicy"],
      [rent.id, { categoryId: other.rent }, 404, "CategoryNotFound"],
      [contribution.id, { categoryId: h.rent }, 422, "InvalidRecurrence"],
      [
        contribution.id,
        { split: { method: "EQUAL", participants: [{ memberId: h.ana.memberId }] } },
        422,
        "InvalidRecurrence",
      ],
    ];
    const answers: [string, Record<string, unknown>, number, string][] = [];
    for (const [id, body] of refused)
      answers.push([id, body, ...(await problemOf(await patchRecurrence(h.ana, h.spaceId, id, body)))]);
    expect(answers).toEqual(refused);
    expect(await recurrenceOf(h.ana, h.spaceId, rent.id)).toEqual(rent);
  });

  it("refuses every edit of an ended recurrence: 409 RecurrenceEnded", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h, { endDate: "2027-06-30" }));
    expect((await endRecurrence(h.ana, h.spaceId, rent.id)).status).toBe(200);
    expect([
      await problemOf(await patchRecurrence(h.ana, h.spaceId, rent.id, { endDate: null })),
      await problemOf(await patchRecurrence(h.ana, h.spaceId, rent.id, { amount: cop(1_300_000) })),
    ]).toEqual([
      [409, "RecurrenceEnded"],
      [409, "RecurrenceEnded"],
    ]);
    expect(await recurrenceOf(h.ana, h.spaceId, rent.id)).toMatchObject({
      status: "ENDED",
      endDate: "2027-06-30",
    });
  });
});

describe("pausing, resuming and ending a recurrence (HU-E4-11)", () => {
  const read = async (response: Response) => [
    response.status,
    ((await response.json()) as RecurrenceDto).status,
  ];
  const moves = [pauseRecurrence, resumeRecurrence, endRecurrence];
  /** Ana's Gym and her monthly fund contribution: both move money through her own account (D9). */
  const fromHerOwnAccount = (h: HouseholdWithFund) => [
    rentBody(h, {
      description: "Gym",
      amount: cop(90_000),
      template: {
        type: "EXPENSE",
        categoryId: h.utilities,
        payer: { memberId: h.ana.memberId, accountId: h.ana.account },
      },
      schedule: { kind: "MONTHLY", day: 3 },
      startDate: "2026-12-03",
    }),
    rentBody(h, {
      description: "Fund",
      template: { type: "FUND_CONTRIBUTION", fundAccountId: h.fund, sourceAccountId: h.ana.account },
    }),
  ];
  /** The owner changes a member's role; throws unless 200. */
  const changeRole = async (h: HouseholdWithFund, memberId: string, role: string) => {
    const response = await call(
      changeMemberRole,
      "PATCH",
      `/api/v1/spaces/${h.spaceId}/members/${memberId}`,
      {
        user: h.ana,
        params: { spaceId: h.spaceId, memberId },
        body: { role },
      },
    );
    if (response.status !== 200) throw new Error(`role change failed with status ${response.status}`);
  };
  /** The member leaves the household; throws unless 204. */
  const leave = async (user: TestUser, spaceId: string) => {
    const response = await call(leaveSpace, "POST", `/api/v1/spaces/${spaceId}/leave`, {
      user,
      params: { spaceId },
    });
    if (response.status !== 204) throw new Error(`leaving failed with status ${response.status}`);
  };

  it("pauses Rent with no next occurrence, then resumes it: next on 2026-12-01", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    expect(await read(await pauseRecurrence(h.ana, h.spaceId, rent.id))).toEqual([200, "PAUSED"]);
    expect(await recurrenceOf(h.ana, h.spaceId, rent.id)).toMatchObject({
      pauseReason: null,
      nextOccurrence: null,
    });
    expect(await read(await resumeRecurrence(h.ana, h.spaceId, rent.id))).toEqual([200, "ACTIVE"]);
    expect((await recurrenceOf(h.ana, h.spaceId, rent.id)).nextOccurrence).toBe("2026-12-01");
  });

  it("answers 409 InvalidRecurrenceTransition to pausing a paused recurrence or resuming an active one", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    expect(await problemOf(await resumeRecurrence(h.ana, h.spaceId, rent.id))).toEqual([
      409,
      "InvalidRecurrenceTransition",
    ]);
    await pauseRecurrence(h.ana, h.spaceId, rent.id);
    expect(await problemOf(await pauseRecurrence(h.ana, h.spaceId, rent.id))).toEqual([
      409,
      "InvalidRecurrenceTransition",
    ]);
  });

  it("ends Rent logically: ENDED and still read, refusing edits (409 RecurrenceEnded) and every move", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    expect(await read(await endRecurrence(h.ana, h.spaceId, rent.id))).toEqual([200, "ENDED"]);
    expect([
      (await recurrenceOf(h.ana, h.spaceId, rent.id)).nextOccurrence,
      await problemOf(await patchRecurrence(h.ana, h.spaceId, rent.id, { description: "Rent" })),
      await problemOf(await pauseRecurrence(h.ana, h.spaceId, rent.id)),
      await problemOf(await resumeRecurrence(h.ana, h.spaceId, rent.id)),
      await problemOf(await endRecurrence(h.ana, h.spaceId, rent.id)),
    ]).toEqual([
      null,
      [409, "RecurrenceEnded"],
      [409, "InvalidRecurrenceTransition"],
      [409, "InvalidRecurrenceTransition"],
      [409, "InvalidRecurrenceTransition"],
    ]);
  });

  it("treats a recurrence an edit left no date to record as ended too: every move and every edit is refused", async () => {
    const h = await householdWithFund();
    // MONTHLY(1) from 2026-12-02 first records on 2027-01-01: an end date before it leaves nothing to record.
    const rent = await defined(h.ana, h.spaceId, rentBody(h, { startDate: "2026-12-02" }));
    expect(await read(await patchRecurrence(h.ana, h.spaceId, rent.id, { endDate: "2026-12-15" }))).toEqual([
      200,
      "ENDED",
    ]);
    expect([
      await problemOf(await pauseRecurrence(h.ana, h.spaceId, rent.id)),
      await problemOf(await resumeRecurrence(h.ana, h.spaceId, rent.id)),
      await problemOf(await endRecurrence(h.ana, h.spaceId, rent.id)),
      await problemOf(await patchRecurrence(h.ana, h.spaceId, rent.id, { endDate: null })),
    ]).toEqual([
      [409, "InvalidRecurrenceTransition"],
      [409, "InvalidRecurrenceTransition"],
      [409, "InvalidRecurrenceTransition"],
      [409, "RecurrenceEnded"],
    ]);
  });

  it("previews no dates while Rent is paused or ended, and its dates again once it resumes", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    const preview = async (count?: string) => {
      const response = await upcoming(h.ana, h.spaceId, rent.id, count);
      return [response.status, await response.json()];
    };
    const dates = [200, { dates: ["2026-12-01", "2027-01-01", "2027-02-01"] }];
    const none = [200, { dates: [] }];
    const seen = [await preview()];
    await pauseRecurrence(h.ana, h.spaceId, rent.id);
    seen.push(await preview(), await preview("24"));
    await resumeRecurrence(h.ana, h.spaceId, rent.id);
    seen.push(await preview());
    await endRecurrence(h.ana, h.spaceId, rent.id);
    seen.push(await preview(), await preview("24"));
    expect(seen).toEqual([dates, none, none, dates, none, none]);
  });

  it("edits a paused recurrence as the domain says: 200, still PAUSED with no next date, and the edit is what resumes", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    await pauseRecurrence(h.ana, h.spaceId, rent.id);
    const edit = { amount: cop(1_300_000), description: "Rent, renewed", endDate: "2027-06-30" };
    const response = await patchRecurrence(h.ana, h.spaceId, rent.id, edit);
    const edited = await recurrenceOf(h.ana, h.spaceId, rent.id);
    expect([response.status, await response.json()]).toEqual([200, edited]);
    expect(edited).toMatchObject({ ...edit, status: "PAUSED", pauseReason: null, nextOccurrence: null });
    expect(await read(await resumeRecurrence(h.ana, h.spaceId, rent.id))).toEqual([200, "ACTIVE"]);
    expect(await recurrenceOf(h.ana, h.spaceId, rent.id)).toMatchObject({
      ...edit,
      nextOccurrence: "2026-12-01",
    });
  });

  it("reads pauseReason null once a paused recurrence resumes or ends, a reason the scheduler gave it included", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.juan, h.spaceId, rentBody(h));
    // Every occurrence is recorded on behalf of the recurrence's creator (P21): once Juan is a VIEWER the ledger refuses
    // it and the scheduler pauses the recurrence with that code (P26). The job handles every active recurrence of the
    // database, so only this test's is looked at. A payer or creator who left could not resume it, so Juan stays.
    const schedulerPausesOn = async (today: string) => {
      await changeRole(h, h.juan.memberId, "VIEWER");
      const report = await app.ledger.materializeDueOccurrences({ today: today as LocalDate });
      expect([
        report.failures.filter((f) => f.recurrenceId === rent.id),
        report.paused.filter((p) => p.recurrenceId === rent.id).map((p) => p.reason),
      ]).toEqual([[], ["InsufficientRole"]]);
    };
    const reasonOf = async (response: Response) => {
      const { status, pauseReason } = (await response.json()) as RecurrenceDto;
      return [response.status, status, pauseReason];
    };
    await schedulerPausesOn("2026-12-01");
    const seen = [await reasonOf(await getRecurrence(h.ana, h.spaceId, rent.id))];
    // Resuming asks that its creator can record again.
    await changeRole(h, h.juan.memberId, "MEMBER");
    seen.push(await reasonOf(await resumeRecurrence(h.ana, h.spaceId, rent.id)));
    seen.push(await reasonOf(await getRecurrence(h.ana, h.spaceId, rent.id)));
    await schedulerPausesOn("2027-01-01");
    seen.push(await reasonOf(await endRecurrence(h.ana, h.spaceId, rent.id)));
    seen.push(await reasonOf(await getRecurrence(h.ana, h.spaceId, rent.id)));
    expect(seen).toEqual([
      [200, "PAUSED", "InsufficientRole"],
      [200, "ACTIVE", null],
      [200, "ACTIVE", null],
      [200, "ENDED", null],
      [200, "ENDED", null],
    ]);
  });

  it("lets Juan, a MEMBER, manage only the recurrences he defined (P30)", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    const his = await defined(h.juan, h.spaceId, rentBody(h, { description: "Juan's share of rent" }));
    expect([
      await problemOf(await pauseRecurrence(h.juan, h.spaceId, rent.id)),
      (await pauseRecurrence(h.juan, h.spaceId, his.id)).status,
      (await endRecurrence(h.ana, h.spaceId, his.id)).status,
    ]).toEqual([[403, "InsufficientRole"], 200, 200]);
  });

  it("refuses Juan every move of Ana's Rent, active or paused: 403 InsufficientRole, and Rent is as she left it", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    const refusals = async () => {
      const answers: [number, string][] = [];
      for (const move of moves) answers.push(await problemOf(await move(h.juan, h.spaceId, rent.id)));
      return answers;
    };
    const refused = Array<[number, string]>(3).fill([403, "InsufficientRole"]);
    // The role is checked before the status: Juan learns nothing of whether Rent is paused.
    expect(await refusals()).toEqual(refused);
    expect(await recurrenceOf(h.ana, h.spaceId, rent.id)).toEqual(rent);
    await pauseRecurrence(h.ana, h.spaceId, rent.id);
    expect(await refusals()).toEqual(refused);
    expect((await recurrenceOf(h.ana, h.spaceId, rent.id)).status).toBe("PAUSED");
  });

  it("lets Luis the ADMIN pause, resume and end the Rent paid from the shared fund, which debits nobody's own account", async () => {
    const h = await householdWithFund();
    const luis = await joinHousehold(h, "Luis", "ADMIN");
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    const answers: unknown[] = [];
    for (const move of moves) answers.push(await read(await move(luis, h.spaceId, rent.id)));
    expect(answers).toEqual([
      [200, "PAUSED"],
      [200, "ACTIVE"],
      [200, "ENDED"],
    ]);
  });

  it("lets Luis the ADMIN pause and end what Ana pays from her own account but not resume it: 422 AccountNotOwned (D9)", async () => {
    const h = await householdWithFund();
    const luis = await joinHousehold(h, "Luis", "ADMIN");
    const outcomes: unknown[] = [];
    for (const body of fromHerOwnAccount(h)) {
      const own = await defined(h.ana, h.spaceId, body);
      outcomes.push([
        (await pauseRecurrence(luis, h.spaceId, own.id)).status,
        await problemOf(await resumeRecurrence(luis, h.spaceId, own.id)),
        (await recurrenceOf(h.ana, h.spaceId, own.id)).status,
        await read(await resumeRecurrence(h.ana, h.spaceId, own.id)),
        (await endRecurrence(luis, h.spaceId, own.id)).status,
      ]);
    }
    expect(outcomes).toEqual(Array(2).fill([200, [422, "AccountNotOwned"], "PAUSED", [200, "ACTIVE"], 200]));
  });

  it("refuses to resume what its creator, demoted to VIEWER, can no longer record: 403 InsufficientRole (P21)", async () => {
    const h = await householdWithFund();
    const his = await defined(h.juan, h.spaceId, rentBody(h, { description: "Juan's share of rent" }));
    expect((await pauseRecurrence(h.juan, h.spaceId, his.id)).status).toBe(200);
    await changeRole(h, h.juan.memberId, "VIEWER");
    expect([
      await problemOf(await resumeRecurrence(h.ana, h.spaceId, his.id)),
      (await recurrenceOf(h.ana, h.spaceId, his.id)).status,
      await problemOf(await resumeRecurrence(h.juan, h.spaceId, his.id)),
      (await endRecurrence(h.ana, h.spaceId, his.id)).status,
    ]).toEqual([[403, "InsufficientRole"], "PAUSED", [403, "InsufficientRole"], 200]);
  });

  it("refuses to resume what its creator left behind: 422 NotASpaceMember, while Ana can still end it (P26)", async () => {
    const h = await householdWithFund();
    const his = await defined(h.juan, h.spaceId, rentBody(h, { description: "Juan's share of rent" }));
    expect((await pauseRecurrence(h.ana, h.spaceId, his.id)).status).toBe(200);
    await leave(h.juan, h.spaceId);
    expect([
      await problemOf(await resumeRecurrence(h.ana, h.spaceId, his.id)),
      (await recurrenceOf(h.ana, h.spaceId, his.id)).status,
      (await endRecurrence(h.ana, h.spaceId, his.id)).status,
    ]).toEqual([[422, "NotASpaceMember"], "PAUSED", 200]);
  });

  it("answers the same 404 RecurrenceNotFound on every move for another space's, an unknown and a malformed id", async () => {
    const h = await householdWithFund();
    const other = await householdWithFund();
    const theirs = await defined(other.ana, other.spaceId, rentBody(other));
    const answers: [number, Record<string, unknown>][] = [];
    for (const id of [theirs.id, randomUUID(), "not-a-uuid"]) {
      for (const move of moves) answers.push(await problemBodyOf(await move(h.ana, h.spaceId, id)));
    }
    expect(answers).toHaveLength(9);
    expect(answers[0]).toMatchObject([404, { code: "RecurrenceNotFound" }]);
    for (const answer of answers) expect(answer).toEqual(answers[0]);
    expect(await recurrenceOf(other.ana, other.spaceId, theirs.id)).toEqual(theirs);
  });

  it("refuses Sofi the VIEWER with 403 and a stranger with 404 SpaceNotFound on every move", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    const luis = await registerUser("Luis");
    const answers: [number, string][] = [];
    for (const user of [sofi, luis]) {
      for (const move of moves) answers.push(await problemOf(await move(user, h.spaceId, rent.id)));
    }
    expect(answers).toEqual([
      ...Array<[number, string]>(3).fill([403, "InsufficientRole"]),
      ...Array<[number, string]>(3).fill([404, "SpaceNotFound"]),
    ]);
    expect(await recurrenceOf(h.ana, h.spaceId, rent.id)).toEqual(rent);
  });

  it("refuses every move in an archived space with 409 SpaceArchived, paused or not, while it still reads (HU-E1-09)", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    const paused = await defined(h.ana, h.spaceId, rentBody(h, { description: "Paused rent" }));
    await pauseRecurrence(h.ana, h.spaceId, paused.id);
    await archiveHousehold(h);
    const answers: [number, string][] = [];
    for (const id of [rent.id, paused.id]) {
      for (const move of moves) answers.push(await problemOf(await move(h.ana, h.spaceId, id)));
      answers.push(await problemOf(await patchRecurrence(h.ana, h.spaceId, id, { description: "Rent" })));
    }
    expect(answers).toEqual(Array<[number, string]>(8).fill([409, "SpaceArchived"]));
    expect([
      await recurrenceOf(h.ana, h.spaceId, rent.id),
      (await recurrenceOf(h.ana, h.spaceId, paused.id)).status,
    ]).toEqual([rent, "PAUSED"]);
  });
});
