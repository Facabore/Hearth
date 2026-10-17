import { describe, expect, it } from "vitest";
import { FixedClock, type LocalDate } from "@/shared/kernel";
import { codeOf, fixedTimeZones, money, unwrap } from "../../../../tests/support/fakes";
import {
  ACCOUNTS,
  anExpense,
  CATEGORIES,
  householdLedger,
  ledgerFixture,
} from "../../../../tests/support/in-memory-ledger";
import { HOUSEHOLD_MEMBERS } from "../../../../tests/support/in-memory-spaces";
import { createEditTransaction } from "./edit-transaction";
import { createListTransactions } from "./list-transactions";
import { createRecordExpense } from "./record-expense";
import { createRecordFundContribution } from "./record-fund-contribution";
import { createRecordIncome } from "./record-income";
import { createRecordSettlement } from "./record-settlement";
import { createRecordTransfer } from "./record-transfer";

const at = new Date("2026-10-17T03:30:00Z");
const fixture = (zones: Record<string, string> = {}, clock = at) =>
  ledgerFixture({ clock: new FixedClock(clock), userTimeZones: fixedTimeZones(zones) });
const inHousehold = (zones: Record<string, string> = {}) =>
  householdLedger(HOUSEHOLD_MEMBERS, { clock: new FixedClock(at), userTimeZones: fixedTimeZones(zones) });
const asAna = { spaceId: "space-ana", userId: "u-ana" };
const coffee = {
  ...asAna,
  description: "Coffee",
  categoryId: CATEGORIES.restaurants.id,
  amount: money(1_200_000n),
  accountId: ACCOUNTS.bancolombia.id,
};
const timeOf = (tx: { date: string; occurredAt: Date | null; timeZone: string | null }) => [
  tx.date,
  tx.occurredAt?.toISOString() ?? null,
  tx.timeZone,
];

describe("recording with a time (HU-E4-14)", () => {
  it("takes the moment of recording in the recorder's zone", async () => {
    const recorded = unwrap(await createRecordExpense(fixture().deps)(coffee)).expense;
    expect(timeOf(recorded)).toEqual(["2026-10-16", "2026-10-17T03:30:00.000Z", "America/Bogota"]);
    const inMadrid = unwrap(
      await createRecordExpense(fixture({ "u-ana": "Europe/Madrid" }).deps)(coffee),
    ).expense;
    expect(timeOf(inMadrid)).toEqual(["2026-10-17", "2026-10-17T03:30:00.000Z", "Europe/Madrid"]);
  });

  it("records the instant it happened, gives a date alone the time of day of now, and refuses the rest", async () => {
    const record = createRecordExpense(fixture().deps);
    const occurredAt = new Date("2026-10-16T14:32:00-05:00");
    expect(timeOf(unwrap(await record({ ...coffee, occurredAt })).expense)).toEqual([
      "2026-10-16",
      "2026-10-16T19:32:00.000Z",
      "America/Bogota",
    ]);
    const date = "2026-10-15" as LocalDate;
    expect(timeOf(unwrap(await record({ ...coffee, date })).expense)).toEqual([
      "2026-10-15",
      "2026-10-16T03:30:00.000Z",
      "America/Bogota",
    ]);
    expect(codeOf(await record({ ...coffee, date, occurredAt }))).toBe("DateTimeMismatch");
    expect(codeOf(await record({ ...coffee, occurredAt: null }))).toBe("TimeRequired");
    expect(codeOf(await record({ ...coffee, timeZone: "Bogota" }))).toBe("InvalidTimeZone");
  });

  it("gives incomes and transfers the same time rules", async () => {
    const { deps } = fixture();
    const occurredAt = new Date("2026-10-16T14:32:00-05:00");
    const income = unwrap(
      await createRecordIncome(deps)({
        ...asAna,
        categoryId: CATEGORIES.salary.id,
        amount: money(320_000_000n),
        accountId: ACCOUNTS.bancolombia.id,
        occurredAt,
      }),
    );
    const transfer = unwrap(
      await createRecordTransfer(deps)({
        ...asAna,
        amount: money(50_000_000n),
        sourceAccountId: ACCOUNTS.bancolombia.id,
        destinationAccountId: ACCOUNTS.nequi.id,
        occurredAt,
        timeZone: "Europe/Madrid",
      }),
    );
    expect(timeOf(income)).toEqual(["2026-10-16", "2026-10-16T19:32:00.000Z", "America/Bogota"]);
    expect(timeOf(transfer)).toEqual(["2026-10-16", "2026-10-16T19:32:00.000Z", "Europe/Madrid"]);
  });

  it("gives a fund contribution and a settlement the recorder's zone, not a guest payer's", async () => {
    const { deps } = inHousehold({ "u-juan": "Europe/Madrid" });
    const asJuan = { spaceId: "space-household", userId: "u-juan" };
    const contribution = unwrap(
      await createRecordFundContribution(deps)({
        ...asJuan,
        amount: money(48_000_000n),
        fundAccountId: ACCOUNTS.householdFund.id,
        memberId: "member-pedro",
      }),
    );
    const settlement = unwrap(
      await createRecordSettlement(deps)({
        ...asJuan,
        amount: money(10_000_000n),
        payerMemberId: "member-pedro",
        receivingMemberId: "member-ana",
        occurredAt: new Date("2026-10-16T14:32:00-05:00"),
      }),
    );
    expect(timeOf(contribution)).toEqual(["2026-10-17", "2026-10-17T03:30:00.000Z", "Europe/Madrid"]);
    expect(timeOf(settlement)).toEqual(["2026-10-16", "2026-10-16T19:32:00.000Z", "Europe/Madrid"]);
  });
});

describe("editing a time (HU-E4-06, HU-E4-14)", () => {
  it("keeps the local time when the date changes, audits it, never removes it, and times an old row", async () => {
    const { deps, store, audit } = fixture();
    const stored = anExpense("2026-10-16", 1_200_000n, {
      occurredAt: new Date("2026-10-16T19:32:00Z"),
      timeZone: "America/Bogota",
    });
    store.rows.push(stored);
    const edit = createEditTransaction(deps);
    const moved = unwrap(
      await edit({
        ...asAna,
        transactionId: stored.id,
        expectedVersion: null,
        changes: { date: "2026-10-14" as LocalDate },
      }),
    );
    expect(timeOf(moved)).toEqual(["2026-10-14", "2026-10-14T19:32:00.000Z", "America/Bogota"]);
    expect(audit.entries.at(-1)?.changes).toEqual({
      date: { from: "2026-10-16", to: "2026-10-14" },
      occurredAt: { from: "2026-10-16T19:32:00.000Z", to: "2026-10-14T19:32:00.000Z" },
    });
    const removal = await edit({
      ...asAna,
      transactionId: stored.id,
      expectedVersion: null,
      changes: { occurredAt: null },
    });
    expect(codeOf(removal)).toBe("TimeRequired");
    expect(timeOf(store.rows.find((t) => t.id === stored.id)!)).toEqual([
      "2026-10-14",
      "2026-10-14T19:32:00.000Z",
      "America/Bogota",
    ]);
    // "Old market", as the migration left it: no time until someone edits one in, in the editor's zone.
    const old = anExpense("2026-09-20", 1_000_000n);
    store.rows.push(old);
    const timed = unwrap(
      await edit({
        ...asAna,
        transactionId: old.id,
        expectedVersion: null,
        changes: { occurredAt: new Date("2026-09-20T10:00:00-05:00") },
      }),
    );
    expect(timeOf(timed)).toEqual(["2026-09-20", "2026-09-20T15:00:00.000Z", "America/Bogota"]);
  });

  it("times a member's old row in the editor's zone, not its creator's, when the owner edits it", async () => {
    const { deps, store } = inHousehold({ "u-ana": "Europe/Madrid", "u-juan": "Asia/Tokyo" });
    const juans = anExpense("2026-09-20", 1_000_000n, { spaceId: "space-household", createdBy: "u-juan" });
    store.rows.push(juans);
    const timed = unwrap(
      await createEditTransaction(deps)({
        spaceId: "space-household",
        userId: "u-ana",
        transactionId: juans.id,
        expectedVersion: null,
        // 22:00 on the 20th in Madrid, but already 05:00 on the 21st in Tokyo.
        changes: { occurredAt: new Date("2026-09-20T20:00:00Z") },
      }),
    );
    expect(timeOf(timed)).toEqual(["2026-09-20", "2026-09-20T20:00:00.000Z", "Europe/Madrid"]);
  });
});

describe("the current period (HU-E1-14, HU-E4-14)", () => {
  it("is the period of today in the requester's zone", async () => {
    const instant = new Date("2026-11-01T04:30:00Z");
    const list = (zones: Record<string, string>) =>
      createListTransactions(fixture(zones, instant).deps)({ ...asAna, after: null, limit: 50 });
    expect(unwrap(await list({})).period.label).toBe("2026-10");
    expect(unwrap(await list({ "u-ana": "Europe/Madrid" })).period.label).toBe("2026-11");
  });
});
