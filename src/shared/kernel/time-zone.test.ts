import { describe, expect, it } from "vitest";
import type { LocalDate } from "./local-date";
import {
  canonicalTimeZone,
  instantAt,
  isIanaName,
  localDateIn,
  parseTimeZone,
  wallTimeIn,
} from "./time-zone";

const at = (iso: string) => new Date(iso);
const wall = (hour: number, minute: number) => ({ hour, minute, second: 0, millisecond: 0 });
const day = (iso: string) => iso as LocalDate;

describe("time zones (HU-E1-14)", () => {
  it("accepts what Intl accepts, by its canonical name", () => {
    expect(canonicalTimeZone("america/bogota")).toBe("America/Bogota");
    expect(canonicalTimeZone("Europe/Madrid")).toBe("Europe/Madrid");
    expect(canonicalTimeZone("UTC")).toBe("UTC");
  });

  it("keeps IANA aliases and legacy names, canonicalised by Intl", () => {
    expect(canonicalTimeZone("US/Pacific")).toBe("America/Los_Angeles");
    expect(canonicalTimeZone("etc/gmt+5")).toBe("Etc/GMT+5");
    expect(canonicalTimeZone("GMT")).toBe("UTC");
    expect(parseTimeZone("america/bogota")).toEqual({ ok: true, value: "America/Bogota" });
  });

  it.each(["+05:00", "-03:30", "+0500", "-03", "+05", "+14:00"])(
    "refuses the offset-form name %j on the write paths, though Intl accepts it (issue 126)",
    (raw) => {
      expect(isIanaName(raw)).toBe(false);
      expect(parseTimeZone(raw)).toEqual({
        ok: false,
        error: { code: "InvalidTimeZone", details: { value: raw } },
      });
    },
  );

  it.each(["America/Bogota", "america/bogota", "US/Pacific", "Etc/GMT+5", "UTC", "GMT"])(
    "takes %j as an IANA name",
    (raw) => expect(isIanaName(raw)).toBe(true),
  );

  it.each([
    ["+05:00", "+05:00"],
    ["-03:30", "-03:30"],
    ["+0500", "+05:00"],
  ])("still reads a stored offset-form name %j as itself (%j): readers never change", (raw, canonical) => {
    expect(canonicalTimeZone(raw)).toBe(canonical);
  });

  it.each(["Bogota", "Mars/Olympus", ""])("refuses %j", (raw) => {
    expect(canonicalTimeZone(raw)).toBeNull();
    expect(parseTimeZone(raw)).toEqual({
      ok: false,
      error: { code: "InvalidTimeZone", details: { value: raw } },
    });
  });
});

describe("local dates and wall-clock times (HU-E4-14)", () => {
  it("reads an instant's date and time in a zone", () => {
    expect(localDateIn(at("2026-11-01T04:30:00Z"), "America/Bogota")).toBe("2026-10-31");
    expect(localDateIn(at("2026-11-01T04:30:00Z"), "Europe/Madrid")).toBe("2026-11-01");
    expect(wallTimeIn(at("2026-10-16T19:32:07.250Z"), "America/Bogota")).toEqual({
      hour: 14,
      minute: 32,
      second: 7,
      millisecond: 250,
    });
    expect(wallTimeIn(at("2026-10-17T03:30:00Z"), "Europe/Madrid")).toEqual(wall(5, 30));
  });

  it("finds the instant of a wall-clock time", () => {
    expect(instantAt(day("2026-10-14"), wall(14, 32), "America/Bogota").toISOString()).toBe(
      "2026-10-14T19:32:00.000Z",
    );
    expect(instantAt(day("2026-03-29"), wall(10, 0), "Europe/Madrid").toISOString()).toBe(
      "2026-03-29T08:00:00.000Z",
    );
    expect(instantAt(day("2026-03-29"), wall(0, 30), "Europe/Madrid").toISOString()).toBe(
      "2026-03-28T23:30:00.000Z",
    );
    expect(
      instantAt(
        day("2026-10-16"),
        { hour: 14, minute: 32, second: 7, millisecond: 250 },
        "America/Bogota",
      ).toISOString(),
    ).toBe("2026-10-16T19:32:07.250Z");
  });

  it("moves a skipped time forward and takes the first of a repeated one", () => {
    // 02:00 → 03:00 on 2026-03-29 in Madrid: 02:30 does not exist and becomes 03:30 CEST.
    expect(instantAt(day("2026-03-29"), wall(2, 30), "Europe/Madrid").toISOString()).toBe(
      "2026-03-29T01:30:00.000Z",
    );
    // 03:00 → 02:00 on 2026-10-25 in Madrid: 02:30 happens twice; the first is 02:30 CEST.
    expect(instantAt(day("2026-10-25"), wall(2, 30), "Europe/Madrid").toISOString()).toBe(
      "2026-10-25T00:30:00.000Z",
    );
    // 02:00 → 03:00 on 2026-09-27 in Auckland (UTC+12, +13 after): 02:30 does not exist and becomes 03:30 NZDT.
    expect(instantAt(day("2026-09-27"), wall(2, 30), "Pacific/Auckland").toISOString()).toBe(
      "2026-09-26T14:30:00.000Z",
    );
    // 03:00 → 02:00 on 2026-04-05 in Auckland: 02:30 happens twice; the first is 02:30 NZDT.
    expect(instantAt(day("2026-04-05"), wall(2, 30), "Pacific/Auckland").toISOString()).toBe(
      "2026-04-04T13:30:00.000Z",
    );
  });

  it("keeps a time that falls in a gap at the end of the day on that day (issue 119, D19)", () => {
    // 23:00 → 24:00 on 2026-03-28 in Nuuk (UTC-2, -1 after): 23:30 does not exist, and moving it forward by the gap
    // would land on 2026-03-29, so it takes the last instant of 2026-03-28 before the gap, 22:59:59.999.
    const instant = instantAt(day("2026-03-28"), wall(23, 30), "America/Nuuk");
    expect(instant.toISOString()).toBe("2026-03-29T00:59:59.999Z");
    expect(localDateIn(instant, "America/Nuuk")).toBe("2026-03-28");
    expect(wallTimeIn(instant, "America/Nuuk")).toEqual({
      hour: 22,
      minute: 59,
      second: 59,
      millisecond: 999,
    });
    // The whole skipped hour behaves alike, and the first time after the gap is an ordinary one on the next day.
    expect(instantAt(day("2026-03-28"), wall(23, 0), "America/Nuuk").toISOString()).toBe(
      "2026-03-29T00:59:59.999Z",
    );
    expect(instantAt(day("2026-03-29"), wall(0, 0), "America/Nuuk").toISOString()).toBe(
      "2026-03-29T01:00:00.000Z",
    );
    // The time before the gap and the same time on the days around it are untouched.
    expect(instantAt(day("2026-03-28"), wall(22, 59), "America/Nuuk").toISOString()).toBe(
      "2026-03-29T00:59:00.000Z",
    );
    expect(instantAt(day("2026-03-27"), wall(23, 30), "America/Nuuk").toISOString()).toBe(
      "2026-03-28T01:30:00.000Z",
    );
    expect(instantAt(day("2026-03-29"), wall(23, 30), "America/Nuuk").toISOString()).toBe(
      "2026-03-30T00:30:00.000Z",
    );
  });

  it("keeps the first of a repeated time at the end of the day on that day, and a gap at the start of it", () => {
    // 24:00 → 23:00 on 2026-04-04 in Santiago (UTC-3, -4 after): 23:30 happens twice, on the same day; the first wins.
    expect(instantAt(day("2026-04-04"), wall(23, 30), "America/Santiago").toISOString()).toBe(
      "2026-04-05T02:30:00.000Z",
    );
    // 24:00 → 01:00 on 2026-09-06 in Santiago (UTC-4, -3 after): 00:30 does not exist and becomes 01:30, still that day.
    const instant = instantAt(day("2026-09-06"), wall(0, 30), "America/Santiago");
    expect(instant.toISOString()).toBe("2026-09-06T04:30:00.000Z");
    expect(localDateIn(instant, "America/Santiago")).toBe("2026-09-06");
  });

  it("leaves a day that a zone skipped altogether where the old rule put it", () => {
    // Pacific/Apia moved across the date line and has no 2011-12-30: no instant keeps that date, so the time moves
    // forward by the gap as before, onto 2011-12-31.
    const instant = instantAt(day("2011-12-30"), wall(10, 0), "Pacific/Apia");
    expect(instant.toISOString()).toBe("2011-12-30T20:00:00.000Z");
    expect(localDateIn(instant, "Pacific/Apia")).toBe("2011-12-31");
  });

  it("answers an ordinary time of an ordinary day exactly as before, in a zone without a clock change", () => {
    // America/Bogota is UTC-5 all year: every wall time of every day of 2026 is the wall time plus five hours.
    for (let ordinal = 0; ordinal < 365; ordinal += 1) {
      const date = new Date(Date.UTC(2026, 0, 1 + ordinal)).toISOString().slice(0, 10) as LocalDate;
      for (const [hour, minute] of [
        [0, 0],
        [2, 30],
        [12, 0],
        [23, 59],
      ] as const) {
        const expected = Date.parse(`${date}T00:00:00Z`) + ((hour + 5) * 60 + minute) * 60_000;
        expect(instantAt(date, wall(hour, minute), "America/Bogota").getTime()).toBe(expected);
      }
    }
    // And an ordinary day of a zone that has changes, the day before and the day after one.
    expect(instantAt(day("2026-03-28"), wall(23, 30), "Europe/Madrid").toISOString()).toBe(
      "2026-03-28T22:30:00.000Z",
    );
    expect(instantAt(day("2026-03-30"), wall(0, 30), "Europe/Madrid").toISOString()).toBe(
      "2026-03-29T22:30:00.000Z",
    );
  });
});
