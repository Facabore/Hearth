import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setContainerForTests, type Container } from "@/composition/container";
import { problemOf, startTestApp } from "../support/app";
import { MovableClock } from "../support/in-memory-recurrences";
import { householdWithFund, listRecurrences, previewSchedule } from "../support/recurrences";

let app: Container;
/** The definition day, 2026-10-28 in Bogota. */
const clock = new MovableClock("2026-10-28");
beforeAll(() => {
  app = startTestApp({ clock });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

describe("POST /api/v1/spaces/{spaceId}/recurrences/preview (#77, HU-E9-09)", () => {
  it("previews MONTHLY(31) from 2027-01-01 as 2027-01-31, 2027-02-28 and 2027-03-31, and stores nothing", async () => {
    const h = await householdWithFund();
    const response = await previewSchedule(h.ana, h.spaceId, {
      schedule: { kind: "MONTHLY", day: 31 },
      startDate: "2027-01-01",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ dates: ["2027-01-31", "2027-02-28", "2027-03-31"] });
    const list = await listRecurrences(h.ana, h.spaceId);
    expect(((await list.json()) as { items: unknown[] }).items).toEqual([]);
  });

  it("answers 422 for a count out of 1-24, an invalid anchor and an end before the start", async () => {
    const h = await householdWithFund();
    const schedule = { kind: "MONTHLY", day: 1 };
    expect([
      await problemOf(
        await previewSchedule(h.ana, h.spaceId, { schedule, startDate: "2027-01-01", count: 25 }),
      ),
      await problemOf(
        await previewSchedule(h.ana, h.spaceId, {
          schedule: { kind: "MONTHLY", day: 32 },
          startDate: "2027-01-01",
        }),
      ),
      await problemOf(
        await previewSchedule(h.ana, h.spaceId, { schedule, startDate: "2027-01-01", endDate: "2026-12-01" }),
      ),
    ]).toEqual([
      [422, "ValidationFailed"],
      [422, "InvalidPeriodPolicy"],
      [422, "InvalidRecurrence"],
    ]);
  });
});
