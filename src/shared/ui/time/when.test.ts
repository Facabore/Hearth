import { describe, expect, it } from "vitest";
import { monthGrid, nowIn, occurredAtOf, relativeDay, stepHour, stepMinutes, withHalf } from "./when";

describe("time of a record (HU-E9-03, ruling P129)", () => {
  it("reads now on the zone's clock: 04:30Z is still 31 October in Bogotá", () => {
    expect(nowIn(new Date("2026-11-01T04:30:00Z"), "America/Bogota")).toEqual({
      date: "2026-10-31",
      wall: { hour: 23, minute: 30 },
    });
  });

  it("names today, yesterday and the day before yesterday, and nothing older or later", () => {
    expect(relativeDay("2026-10-31", "2026-10-31")).toBe("today");
    expect(relativeDay("2026-10-30", "2026-10-31")).toBe("yesterday");
    expect(relativeDay("2026-10-29", "2026-10-31")).toBe("dayBeforeYesterday");
    expect(relativeDay("2026-10-28", "2026-10-31")).toBeNull();
    expect(relativeDay("2026-11-01", "2026-10-31")).toBeNull();
  });

  it("steps minutes to the next multiple of five in the direction pressed, within the day", () => {
    expect(stepMinutes({ hour: 22, minute: 32 }, 5)).toEqual({ hour: 22, minute: 35 });
    expect(stepMinutes({ hour: 22, minute: 32 }, -5)).toEqual({ hour: 22, minute: 30 });
    expect(stepMinutes({ hour: 19, minute: 30 }, -5)).toEqual({ hour: 19, minute: 25 });
    expect(stepMinutes({ hour: 23, minute: 55 }, 5)).toEqual({ hour: 0, minute: 0 });
    expect(stepMinutes({ hour: 0, minute: 0 }, -5)).toEqual({ hour: 23, minute: 55 });
    expect(stepHour({ hour: 0, minute: 10 }, -1)).toEqual({ hour: 23, minute: 10 });
    expect(stepHour({ hour: 23, minute: 10 }, 1)).toEqual({ hour: 0, minute: 10 });
  });

  it("switches between AM and PM without touching the minutes", () => {
    expect(withHalf({ hour: 19, minute: 0 }, "AM")).toEqual({ hour: 7, minute: 0 });
    expect(withHalf({ hour: 7, minute: 0 }, "PM")).toEqual({ hour: 19, minute: 0 });
    expect(withHalf({ hour: 12, minute: 15 }, "PM")).toEqual({ hour: 12, minute: 15 });
  });

  it("turns a local date and time in a zone into the instant sent as occurredAt", () => {
    expect(occurredAtOf("2026-10-15", { hour: 19, minute: 0 }, "America/Bogota")).toBe(
      "2026-10-16T00:00:00.000Z",
    );
    expect(occurredAtOf("2026-10-31", { hour: 23, minute: 30 }, "America/Bogota")).toBe(
      "2026-11-01T04:30:00.000Z",
    );
  });

  it("lays a month out from the person's first weekday", () => {
    const monday = monthGrid(2026, 10, "MONDAY"); // 1 October 2026 is a Thursday
    expect(monday.slice(0, 4)).toEqual([null, null, null, "2026-10-01"]);
    expect(monday).toHaveLength(34);
    expect(monthGrid(2026, 10, "SUNDAY").slice(0, 5)).toEqual([null, null, null, null, "2026-10-01"]);
  });
});
