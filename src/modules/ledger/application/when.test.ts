import { describe, expect, it } from "vitest";
import { FixedClock, type LocalDate } from "@/shared/kernel";
import { codeOf, fixedTimeZones, unwrap } from "../../../../tests/support/fakes";
import { editedTime, whenOf } from "./when";

const now = new Date("2026-10-17T03:30:00Z");
const depsWith = (zones = fixedTimeZones({ "u-juan": "Europe/Madrid" })) => ({
  clock: new FixedClock(now),
  userTimeZones: zones,
});

describe("whenOf (HU-E4-14)", () => {
  it("takes each recorder's own zone for the moment of recording", async () => {
    expect(unwrap(await whenOf(depsWith(), { userId: "u-ana" }))).toEqual({
      date: "2026-10-16",
      occurredAt: now,
      timeZone: "America/Bogota",
    });
    expect(unwrap(await whenOf(depsWith(), { userId: "u-juan" }))).toEqual({
      date: "2026-10-17",
      occurredAt: now,
      timeZone: "Europe/Madrid",
    });
  });

  it("prefers a sent zone by its canonical name and refuses an unknown one", async () => {
    expect(unwrap(await whenOf(depsWith(), { userId: "u-ana", timeZone: "europe/madrid" })).timeZone).toBe(
      "Europe/Madrid",
    );
    expect(codeOf(await whenOf(depsWith(), { userId: "u-ana", timeZone: "Bogota" }))).toBe("InvalidTimeZone");
  });

  it("gives a date alone the time of day of now, in the sent zone or the recorder's (P66)", async () => {
    const date = "2026-10-15" as LocalDate;
    expect(unwrap(await whenOf(depsWith(), { userId: "u-ana", date }))).toEqual({
      date,
      occurredAt: new Date("2026-10-16T03:30:00Z"), // 22:30 in Bogotá
      timeZone: "America/Bogota",
    });
    expect(unwrap(await whenOf(depsWith(), { userId: "u-ana", date, timeZone: "Europe/Madrid" }))).toEqual({
      date,
      occurredAt: new Date("2026-10-15T03:30:00Z"), // 05:30 in Madrid
      timeZone: "Europe/Madrid",
    });
  });

  it("refuses a null time, and leaves only an untimed system record without one, reading no zone (P66)", async () => {
    expect(codeOf(await whenOf(depsWith(), { userId: "u-ana", occurredAt: null }))).toBe("TimeRequired");
    const zones = fixedTimeZones();
    const date = "2026-10-15" as LocalDate;
    expect(unwrap(await whenOf(depsWith(zones), { userId: "u-ana", date, untimed: true }))).toEqual({
      date,
      occurredAt: null,
      timeZone: null,
    });
    expect(zones.asked).toEqual([]);
  });
});

describe("editedTime (HU-E4-06, HU-E4-14)", () => {
  const untimed = { date: "2026-10-15" as LocalDate, occurredAt: null, timeZone: null };

  it("asks the editor's zone only for a new time on a transaction without one", async () => {
    const zones = fixedTimeZones({ "u-juan": "Europe/Madrid" });
    expect(
      unwrap(await editedTime({ userTimeZones: zones }, untimed, "u-juan", { occurredAt: now })),
    ).toEqual({
      date: "2026-10-17",
      occurredAt: now,
      timeZone: "Europe/Madrid",
    });
    await editedTime({ userTimeZones: zones }, untimed, "u-juan", { date: "2026-10-20" as LocalDate });
    expect(zones.asked).toEqual(["u-juan"]);
  });

  it("refuses an unknown zone and a null time", async () => {
    expect(
      codeOf(await editedTime({ userTimeZones: fixedTimeZones() }, untimed, "u-ana", { timeZone: "x" })),
    ).toBe("InvalidTimeZone");
    expect(
      codeOf(await editedTime({ userTimeZones: fixedTimeZones() }, untimed, "u-ana", { occurredAt: null })),
    ).toBe("TimeRequired");
  });
});
