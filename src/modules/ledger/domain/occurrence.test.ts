import { describe, expect, it } from "vitest";
import type { LocalDate, Result } from "@/shared/kernel";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import {
  confirmedOccurrence,
  pendingOccurrence,
  recordedOccurrence,
  skippedByMember,
  skippedOccurrence,
  type Occurrence,
  type OccurrenceId,
} from "./occurrence";
import { defineRecurrence, revisedRecurrence, type RecurrenceId } from "./recurrence";

const at = new Date("2026-12-10T17:00:00Z");
const later = new Date("2026-12-11T17:00:00Z");
const day = (iso: string) => iso as LocalDate;
/** HU-E4-13 Background: CONFIRM "Electricity", estimated at 180,000 COP, paid by Ana from Bancolombia, MONTHLY(10). */
const electricity = unwrap(
  defineRecurrence({
    id: "rec-electricity" as RecurrenceId,
    spaceId: "space-household",
    description: "Electricity",
    amount: 18_000_000n,
    currency: "COP",
    template: {
      type: "EXPENSE",
      categoryId: "cat-utilities",
      payer: { memberId: "member-ana", accountId: "acc-bancolombia" },
      split: null,
    },
    schedule: { kind: "MONTHLY", day: 10 },
    mode: "CONFIRM",
    startDate: day("2026-12-10"),
    endDate: null,
    createdBy: "u-ana",
    now: at,
    today: day("2026-10-28"),
  }),
);
const pending = pendingOccurrence("occ-1" as OccurrenceId, electricity, day("2026-12-10"), at);
const recorded = recordedOccurrence("occ-2" as OccurrenceId, electricity, day("2027-01-10"), "tx-7", at);
const closed = skippedOccurrence("occ-3" as OccurrenceId, electricity, day("2027-02-10"), "PeriodClosed", at);
const confirmation = { transactionId: "tx-1", amount: 20_530_000n, userId: "u-ana", now: later };
const detailsOf = (result: Result<Occurrence>) => (result.ok ? null : result.error.details);

describe("occurrences (HU-E4-12, HU-E4-13)", () => {
  it("starts PENDING with the estimate, RECORDED with its transaction, or SKIPPED with the refusing code", () => {
    expect(pending).toEqual({
      id: "occ-1",
      recurrenceId: "rec-electricity",
      spaceId: "space-household",
      date: "2026-12-10",
      status: "PENDING",
      amount: 18_000_000n,
      transactionId: null,
      reason: null,
      resolvedBy: null,
      createdAt: at,
      resolvedAt: null,
    });
    expect([recorded.status, recorded.transactionId, closed.status, closed.reason]).toEqual([
      "RECORDED",
      "tx-7",
      "SKIPPED",
      "PeriodClosed",
    ]);
  });

  it("keeps what the scheduler did as complete rows: RECORDED points to its transaction, SKIPPED keeps its reason", () => {
    const skipped = skippedOccurrence(
      "occ-4" as OccurrenceId,
      electricity,
      day("2027-03-10"),
      "PayerLeft",
      at,
    );
    expect([recorded, skipped]).toEqual([
      { ...pending, id: "occ-2", date: "2027-01-10", status: "RECORDED", transactionId: "tx-7" },
      { ...pending, id: "occ-4", date: "2027-03-10", status: "SKIPPED", reason: "PayerLeft" },
    ]);
  });

  it("takes the amount of the recurrence as it is when the occurrence is made, not a later edit", () => {
    const edited = unwrap(revisedRecurrence(electricity, { amount: 19_000_000n }, later));
    const second = pendingOccurrence("occ-5" as OccurrenceId, edited, day("2027-01-10"), later);
    expect([pending.amount, second.amount]).toEqual([18_000_000n, 19_000_000n]);
  });

  it("confirms a pending occurrence once, with the real amount", () => {
    const confirmed = unwrap(confirmedOccurrence(pending, confirmation));
    expect(confirmed).toMatchObject({
      status: "RECORDED",
      amount: 20_530_000n,
      transactionId: "tx-1",
      resolvedBy: "u-ana",
      resolvedAt: later,
    });
    expect([
      codeOf(confirmedOccurrence(confirmed, confirmation)),
      codeOf(skippedByMember(confirmed, "u-ana", later)),
    ]).toEqual(["OccurrenceNotPending", "OccurrenceNotPending"]);
  });

  it("changes only what the confirmation decides, and leaves the pending occurrence as it was", () => {
    expect(unwrap(confirmedOccurrence(pending, confirmation))).toEqual({
      ...pending,
      status: "RECORDED",
      amount: 20_530_000n,
      transactionId: "tx-1",
      resolvedBy: "u-ana",
      resolvedAt: later,
    });
    expect([pending.status, pending.amount, pending.transactionId, pending.resolvedAt]).toEqual([
      "PENDING",
      18_000_000n,
      null,
      null,
    ]);
  });

  it("confirms with a positive amount only: zero and negative amounts are refused, one minor unit is not", () => {
    const confirm = (amount: bigint) => codeOf(confirmedOccurrence(pending, { ...confirmation, amount }));
    expect([confirm(0n), confirm(-1n), confirm(-20_530_000n), confirm(1n)]).toEqual([
      "InvalidAmount",
      "InvalidAmount",
      "InvalidAmount",
      "ok",
    ]);
  });

  it("skips a pending occurrence for a member, with no reason and no transaction", () => {
    expect(unwrap(skippedByMember(pending, "u-juan", later))).toMatchObject({
      status: "SKIPPED",
      reason: null,
      resolvedBy: "u-juan",
      transactionId: null,
    });
  });

  it("keeps what a skipped occurrence would have recorded, and when a member skipped it", () => {
    expect(unwrap(skippedByMember(pending, "u-juan", later))).toEqual({
      ...pending,
      status: "SKIPPED",
      reason: null,
      resolvedBy: "u-juan",
      resolvedAt: later,
    });
  });

  it("confirms or skips only a PENDING occurrence, whoever recorded or skipped it", () => {
    const byAMember = unwrap(skippedByMember(pending, "u-juan", later));
    const outcomes = [recorded, closed, byAMember].map((occurrence) => [
      codeOf(confirmedOccurrence(occurrence, confirmation)),
      codeOf(skippedByMember(occurrence, "u-ana", later)),
    ]);
    expect(outcomes).toEqual(
      Array.from({ length: 3 }, () => ["OccurrenceNotPending", "OccurrenceNotPending"]),
    );
  });

  it("names the status that refused the move, and answers that before judging the amount", () => {
    expect([
      detailsOf(skippedByMember(recorded, "u-ana", later)),
      detailsOf(skippedByMember(closed, "u-ana", later)),
      codeOf(confirmedOccurrence(recorded, { ...confirmation, amount: 0n })),
    ]).toEqual([{ status: "RECORDED" }, { status: "SKIPPED" }, "OccurrenceNotPending"]);
  });
});
