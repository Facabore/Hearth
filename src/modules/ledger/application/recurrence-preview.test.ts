import { describe, expect, it } from "vitest";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { recurrenceWorld } from "../../../../tests/support/in-memory-recurrences";
import type { LocalDate } from "@/shared/kernel";
import { createPreviewSchedule } from "./recurrence-queries";

const day = (date: string) => date as LocalDate;
const preview = () => createPreviewSchedule(recurrenceWorld().deps);
const draft = (overrides: Partial<Parameters<ReturnType<typeof preview>>[0]> = {}) => ({
  spaceId: "space-household",
  userId: "u-ana",
  schedule: { kind: "MONTHLY" as const, day: 31 },
  startDate: day("2027-01-01"),
  endDate: null,
  count: 3,
  ...overrides,
});

describe("previewing a schedule before it is defined (#77, HU-E9-09)", () => {
  it("clamps short months: MONTHLY(31) from 2027-01-01 lists 2027-01-31, 2027-02-28 and 2027-03-31", async () => {
    expect(unwrap(await preview()(draft()))).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
  });

  it("starts from today when the start date is earlier, as a definition would (ruling P24)", async () => {
    expect(
      unwrap(
        await preview()(
          draft({ schedule: { kind: "MONTHLY", day: 1 }, startDate: day("2026-01-01"), count: 2 }),
        ),
      ),
    ).toEqual(["2026-11-01", "2026-12-01"]);
  });

  it("stops at the end date and lists SEMI_MONTHLY dates in order", async () => {
    expect(
      unwrap(
        await preview()(
          draft({
            schedule: { kind: "SEMI_MONTHLY", day1: 1, day2: 15 },
            startDate: day("2026-11-01"),
            endDate: day("2026-12-10"),
            count: 10,
          }),
        ),
      ),
    ).toEqual(["2026-11-01", "2026-11-15", "2026-12-01"]);
  });

  it("is open to every member, a viewer included, and refuses someone outside the space", async () => {
    const run = preview();
    expect([
      codeOf(await run(draft({ userId: "u-sofi" }))),
      codeOf(await run(draft({ userId: "u-stranger" }))),
    ]).toEqual(["ok", "SpaceNotFound"]);
  });

  it("refuses an invalid anchor, an end before the start and a count out of 1-24, as a definition does", async () => {
    const run = preview();
    expect([
      codeOf(await run(draft({ schedule: { kind: "MONTHLY", day: 32 } }))),
      codeOf(await run(draft({ endDate: day("2026-12-31") }))),
      codeOf(await run(draft({ count: 0 }))),
      codeOf(await run(draft({ count: 25 }))),
    ]).toEqual(["InvalidPeriodPolicy", "InvalidRecurrence", "InvalidRecurrence", "InvalidRecurrence"]);
  });
});
