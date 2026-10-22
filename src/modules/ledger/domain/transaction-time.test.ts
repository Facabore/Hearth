import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { retimed, timeOf, type TransactionTime } from "./transaction-time";

const BOGOTA = "America/Bogota";
const MADRID = "Europe/Madrid";
const NUUK = "America/Nuuk";
const day = (iso: string) => iso as LocalDate;
const now = new Date("2026-10-17T03:30:00Z");
const coffee: TransactionTime = {
  date: day("2026-10-16"),
  occurredAt: new Date("2026-10-16T19:32:00Z"),
  timeZone: BOGOTA,
};
const untimed: TransactionTime = { date: day("2026-10-15"), occurredAt: null, timeZone: null };

describe("timeOf (HU-E4-14)", () => {
  it("dates an instant in the recorder's zone (@critical)", () => {
    const at = new Date("2026-10-16T14:32:00-05:00");
    expect(unwrap(timeOf({ occurredAt: at, timeZone: BOGOTA, now }))).toEqual(coffee);
  });

  it("takes the moment of recording in each user's zone when neither is sent", () => {
    expect(unwrap(timeOf({ timeZone: BOGOTA, now }))).toEqual({
      date: "2026-10-16",
      occurredAt: now,
      timeZone: BOGOTA,
    });
    expect(unwrap(timeOf({ timeZone: MADRID, now }))).toEqual({
      date: "2026-10-17",
      occurredAt: now,
      timeZone: MADRID,
    });
  });

  it("gives a date alone the wall-clock time of now in the zone (ruling P66)", () => {
    // `now` is 22:30 on 2026-10-16 in Bogotá and 05:30 on 2026-10-17 in Madrid.
    expect(unwrap(timeOf({ date: day("2026-10-15"), timeZone: BOGOTA, now }))).toEqual({
      date: "2026-10-15",
      occurredAt: new Date("2026-10-16T03:30:00Z"),
      timeZone: BOGOTA,
    });
    expect(unwrap(timeOf({ date: day("2026-10-15"), timeZone: MADRID, now }))).toEqual({
      date: "2026-10-15",
      occurredAt: new Date("2026-10-15T03:30:00Z"),
      timeZone: MADRID,
    });
    expect(unwrap(timeOf({ date: day("2026-10-16"), timeZone: BOGOTA, now })).occurredAt).toEqual(now);
  });

  it("moves a date alone forward when now's time of day is skipped on that date (Review Focus 1)", () => {
    // 02:30 in Madrid on 2026-03-28; on 2026-03-29 02:30 does not exist and becomes 03:30 CEST.
    const early = new Date("2026-03-28T01:30:00Z");
    expect(unwrap(timeOf({ date: day("2026-03-29"), timeZone: MADRID, now: early }))).toEqual({
      date: "2026-03-29",
      occurredAt: new Date("2026-03-29T01:30:00Z"),
      timeZone: MADRID,
    });
  });

  it("takes now itself for today's date, even in the repeated hour of a fall-back night (ruling P42)", () => {
    // Madrid repeats 02:30 on 2026-10-25: 00:30Z (CEST, the first) and 01:30Z (CET, the second, which is `late`).
    const late = new Date("2026-10-25T01:30:00Z");
    expect(unwrap(timeOf({ date: day("2026-10-25"), timeZone: MADRID, now: late })).occurredAt).toEqual(late);
  });

  it("refuses an explicit null time (TimeRequired)", () => {
    expect(timeOf({ occurredAt: null, timeZone: BOGOTA, now })).toEqual({
      ok: false,
      error: { code: "TimeRequired" },
    });
    expect(codeOf(timeOf({ date: day("2026-10-15"), occurredAt: null, timeZone: BOGOTA, now }))).toBe(
      "TimeRequired",
    );
  });

  it("refuses a date that is not the instant's local date", () => {
    const result = timeOf({ date: day("2026-10-15"), occurredAt: coffee.occurredAt!, timeZone: BOGOTA, now });
    expect(result).toEqual({
      ok: false,
      error: { code: "DateTimeMismatch", details: { date: "2026-10-15", localDate: "2026-10-16" } },
    });
    expect(
      codeOf(timeOf({ date: day("2026-10-16"), occurredAt: coffee.occurredAt!, timeZone: BOGOTA, now })),
    ).toBe("ok");
  });

  it.each([
    ["before 1900", "1899-12-31T12:00:00Z", BOGOTA, "1899-12-31T12:00:00.000Z"],
    ["in year 26", "0026-10-16T19:32:00Z", BOGOTA, "0026-10-16T19:32:00.000Z"],
    [
      "past 9999 in the zone",
      "9999-12-31T23:59:59-05:00",
      "Pacific/Kiritimati",
      "+010000-01-01T04:59:59.000Z",
    ],
  ])(
    "refuses an instant whose local date is %s, as a bad date is (InvalidDate)",
    (_, instant, timeZone, value) => {
      const at = new Date(instant);
      expect(timeOf({ occurredAt: at, timeZone, now })).toEqual({
        ok: false,
        error: { code: "InvalidDate", details: { value } },
      });
      // It is the date's range that refuses, before any comparison with a sent date.
      expect(codeOf(timeOf({ date: day("2026-10-16"), occurredAt: at, timeZone, now }))).toBe("InvalidDate");
    },
  );

  it("accepts an instant whose local date is 1900-01-01", () => {
    const at = new Date("1900-01-01T12:00:00Z");
    expect(unwrap(timeOf({ occurredAt: at, timeZone: BOGOTA, now })).date).toBe("1900-01-01");
  });

  it("counts 23:30 on 2026-10-31 in Bogotá in October, whatever its UTC date (Review Focus 1)", () => {
    const late = new Date("2026-10-31T23:30:00-05:00");
    expect(unwrap(timeOf({ occurredAt: late, timeZone: BOGOTA, now })).date).toBe("2026-10-31");
  });
});

describe("retimed (HU-E4-06, HU-E4-14)", () => {
  it("keeps the wall-clock time when only the date changes", () => {
    expect(unwrap(retimed(coffee, { date: day("2026-10-14") }, MADRID))).toEqual({
      date: "2026-10-14",
      occurredAt: new Date("2026-10-14T19:32:00Z"),
      timeZone: BOGOTA,
    });
  });

  it("refuses to remove a time, on a transaction with or without one (TimeRequired)", () => {
    expect(retimed(coffee, { occurredAt: null }, BOGOTA)).toEqual({
      ok: false,
      error: { code: "TimeRequired" },
    });
    expect(codeOf(retimed(coffee, { occurredAt: null, date: day("2026-10-14") }, BOGOTA))).toBe(
      "TimeRequired",
    );
    expect(codeOf(retimed(untimed, { occurredAt: null }, BOGOTA))).toBe("TimeRequired");
  });

  it("recomputes the date of a new time in the sent zone, else the stored one, else the editor's", () => {
    const at = new Date("2026-10-17T03:30:00Z");
    expect(unwrap(retimed(coffee, { occurredAt: at }, MADRID))).toEqual({
      date: "2026-10-16",
      occurredAt: at,
      timeZone: BOGOTA,
    });
    expect(unwrap(retimed(coffee, { occurredAt: at, timeZone: MADRID }, BOGOTA)).date).toBe("2026-10-17");
    expect(unwrap(retimed(untimed, { occurredAt: at }, MADRID))).toEqual({
      date: "2026-10-17",
      occurredAt: at,
      timeZone: MADRID,
    });
    expect(codeOf(retimed(coffee, { occurredAt: at, date: day("2026-10-17") }, MADRID))).toBe(
      "DateTimeMismatch",
    );
  });

  it("refuses a new time whose local date is before 1900, and accepts 1900-01-01 (InvalidDate)", () => {
    expect(retimed(coffee, { occurredAt: new Date("1899-12-31T12:00:00Z") }, MADRID)).toEqual({
      ok: false,
      error: { code: "InvalidDate", details: { value: "1899-12-31T12:00:00.000Z" } },
    });
    const sent = { occurredAt: new Date("1899-12-31T12:00:00Z"), date: day("2026-10-16") };
    expect(codeOf(retimed(coffee, sent, MADRID))).toBe("InvalidDate");
    const first = new Date("1900-01-01T12:00:00Z");
    expect(unwrap(retimed(coffee, { occurredAt: first }, MADRID)).date).toBe("1900-01-01");
  });

  it("changes only the date of a transaction without a time, and nothing without a change", () => {
    expect(unwrap(retimed(untimed, { date: day("2026-10-20") }, BOGOTA))).toEqual({
      ...untimed,
      date: "2026-10-20",
    });
    expect(unwrap(retimed(coffee, {}, BOGOTA))).toEqual(coffee);
  });

  it("answers exactly the three time fields, even when given a wider transaction", () => {
    const timeFields = ["date", "occurredAt", "timeZone"];
    const transaction = { ...coffee, id: "t1" };
    const untimedTransaction = { ...untimed, id: "t2" };
    expect(Object.keys(unwrap(retimed(transaction, {}, BOGOTA))).sort()).toEqual(timeFields);
    expect(
      Object.keys(unwrap(retimed(untimedTransaction, { date: day("2026-10-20") }, BOGOTA))).sort(),
    ).toEqual(timeFields);
    expect(unwrap(retimed(transaction, {}, BOGOTA))).toEqual(coffee);
    expect(unwrap(retimed(untimedTransaction, { date: day("2026-10-20") }, BOGOTA))).toEqual({
      ...untimed,
      date: "2026-10-20",
    });
  });

  it("ignores a zone sent without a new time (ruling P44)", () => {
    expect(unwrap(retimed(coffee, { date: day("2026-10-14"), timeZone: MADRID }, BOGOTA))).toEqual({
      date: "2026-10-14",
      occurredAt: new Date("2026-10-14T19:32:00Z"),
      timeZone: BOGOTA,
    });
    expect(unwrap(retimed(coffee, { timeZone: MADRID }, BOGOTA))).toEqual(coffee);
  });

  it("keeps the date when the wall-clock time falls in a gap that ends the day (issue 119, D19)", () => {
    // 23:00 → 24:00 on 2026-03-28 in Nuuk: 23:30 does not exist there, and the old rule landed on 2026-03-29.
    const nuuk: TransactionTime = {
      date: day("2026-03-27"),
      occurredAt: new Date("2026-03-28T01:30:00Z"),
      timeZone: NUUK,
    };
    const moved = unwrap(retimed(nuuk, { date: day("2026-03-28") }, BOGOTA));
    expect(moved).toEqual({
      date: "2026-03-28",
      occurredAt: new Date("2026-03-29T00:59:59.999Z"),
      timeZone: NUUK,
    });
    // A later PATCH resending that instant with the stored date agrees with it.
    expect(unwrap(retimed(moved, { date: day("2026-03-28"), occurredAt: moved.occurredAt }, BOGOTA))).toEqual(
      moved,
    );
  });

  it("keeps the stored instant when a date alone resends the stored date (issue 119)", () => {
    // 03:00 → 02:00 on 2026-10-25 in Madrid: 02:30 CET (01:30Z) is the second 02:30 of the night.
    const second: TransactionTime = {
      date: day("2026-10-25"),
      occurredAt: new Date("2026-10-25T01:30:00Z"),
      timeZone: MADRID,
    };
    expect(unwrap(retimed(second, { date: day("2026-10-25") }, BOGOTA))).toEqual(second);
    // A move away keeps the wall-clock time as before, and so does a move back onto a repeated hour (the first one).
    const away = unwrap(retimed(second, { date: day("2026-10-24") }, BOGOTA));
    expect(away.occurredAt).toEqual(new Date("2026-10-24T00:30:00Z"));
    expect(unwrap(retimed(away, { date: day("2026-10-25") }, BOGOTA)).occurredAt).toEqual(
      new Date("2026-10-25T00:30:00Z"),
    );
    // The same date on a transaction without a time changes nothing either.
    expect(unwrap(retimed(untimed, { date: untimed.date }, BOGOTA))).toEqual(untimed);
  });

  it("gives a date alone the wall-clock time of now, kept on the date when it is skipped at the end of the day", () => {
    // `now` is 23:30 on 2026-03-26 in Nuuk (UTC-2); on 2026-03-28 that time does not exist.
    const evening = new Date("2026-03-27T01:30:00Z");
    const made = unwrap(timeOf({ date: day("2026-03-28"), timeZone: NUUK, now: evening }));
    expect(made).toEqual({
      date: "2026-03-28",
      occurredAt: new Date("2026-03-29T00:59:59.999Z"),
      timeZone: NUUK,
    });
    expect(
      unwrap(timeOf({ date: made.date, occurredAt: made.occurredAt, timeZone: NUUK, now: evening })),
    ).toEqual(made);
  });

  it("moves a skipped 02:30 forward when a Madrid expense moves onto 2026-03-29 (Review Focus 1)", () => {
    const madrid: TransactionTime = {
      date: day("2026-03-28"),
      occurredAt: new Date("2026-03-28T01:30:00Z"),
      timeZone: MADRID,
    };
    expect(unwrap(retimed(madrid, { date: day("2026-03-29") }, BOGOTA)).occurredAt).toEqual(
      new Date("2026-03-29T01:30:00Z"),
    );
  });
});
