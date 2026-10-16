import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setContainerForTests, type Container } from "@/composition/container";
import { problemOf, registerUser, startTestApp } from "../support/app";
import { cop, joinHousehold } from "../support/ledger";
import {
  archiveHousehold,
  DEFINITION_DAY_CLOCK,
  householdWithFund,
  postRecurrence,
  rentBody,
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
