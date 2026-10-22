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
});
