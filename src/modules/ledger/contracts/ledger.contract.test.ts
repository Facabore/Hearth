import { describe, expect, it } from "vitest";
import { encodeCursor } from "@/shared/http/pagination";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import type { TransactionPosition } from "../application";
import {
  DirectSplitBodySchema,
  directSplitFromBody,
  positionFromCursor,
  RecordExpenseBodySchema,
  transactionPageDto,
  whenFromBody,
} from "./ledger.contract";

const body = (overrides: Record<string, unknown> = {}) =>
  DirectSplitBodySchema.parse({
    counterpart: { kind: "GUEST", displayName: "Pedro" },
    description: "Dinner",
    date: "2026-10-14",
    categoryKey: "restaurants",
    amount: { amount: "12000000", currency: "COP" },
    accountId: "acc-bancolombia",
    ...overrides,
  });

describe("direct-split bodies (HU-E1-13)", () => {
  it("names a new guest, or a member, and keeps the expense as RecordExpenseByCategoryKey takes it", () => {
    expect(unwrap(directSplitFromBody(body()))).toEqual({
      counterpart: { guest: { displayName: "Pedro", contactEmail: undefined } },
      expense: {
        description: "Dinner",
        date: "2026-10-14",
        amount: money(12_000_000n),
        accountId: "acc-bancolombia",
        categoryKey: "restaurants",
      },
    });
    const member = body({ counterpart: { kind: "MEMBER", memberId: "member-pedro" } });
    expect(unwrap(directSplitFromBody(member)).counterpart).toEqual({ memberId: "member-pedro" });
  });

  it("refuses currencies the kernel does not know", () => {
    const unknown = body({ amount: { amount: "100", currency: "XYZ" } });
    expect(codeOf(directSplitFromBody(unknown))).toBe("UnknownCurrency");
  });

  it("refuses a counterpart of another kind at the edge", () => {
    expect(DirectSplitBodySchema.safeParse({ ...body(), counterpart: { kind: "FRIEND" } }).success).toBe(
      false,
    );
  });
});

describe("transaction cursors (HU-E4-14)", () => {
  const position = {
    date: "2026-10-16" as LocalDate,
    occurredAt: new Date("2026-10-16T18:05:00.000Z"),
    createdAt: new Date("2026-10-16T18:05:01.000Z"),
    id: "0199f3a2-7c1e-7a10-8b2c-1d2e3f405060",
  };
  const cursorOf = (p: TransactionPosition) =>
    transactionPageDto({
      period: { start: "2026-10-01" as LocalDate, end: "2026-10-31" as LocalDate, label: "2026-10" },
      currency: "COP",
      totals: { expenses: 0n, income: 0n },
      items: [],
      nextPosition: p,
    }).nextCursor!;

  it("round-trips a timed and an untimed position", () => {
    expect(positionFromCursor(cursorOf(position))).toEqual({ ok: true, value: position });
    const untimed = { ...position, occurredAt: null };
    expect(positionFromCursor(cursorOf(untimed))).toEqual({ ok: true, value: untimed });
  });

  it.each([
    ["a cursor from before M3-D", encodeCursor({ sortKey: "2026-10-16", id: position.id })],
    [
      "an impossible instant",
      encodeCursor({ sortKey: "2026-10-16||2026-13-45T00:00:00.000Z", id: position.id }),
    ],
    ["a malformed id", encodeCursor({ sortKey: "2026-10-16||2026-10-16T18:05:01.000Z", id: "x" })],
    [
      "a timed segment that is not an instant",
      encodeCursor({ sortKey: "2026-10-16|garbage|2026-10-16T18:05:01.000Z", id: position.id }),
    ],
    [
      "a key with too few segments",
      encodeCursor({ sortKey: "2026-10-16|2026-10-16T18:05:00.000Z", id: position.id }),
    ],
    [
      "a key with too many segments",
      encodeCursor({
        sortKey: "2026-10-16|2026-10-16T18:05:00.000Z|2026-10-16T18:05:01.000Z|extra",
        id: position.id,
      }),
    ],
  ])("answers InvalidCursor for %s (Review Focus 2)", (_, raw) => {
    expect(positionFromCursor(raw)).toEqual({ ok: false, error: { code: "InvalidCursor" } });
  });
});

describe("time inputs (HU-E4-14)", () => {
  it("accepts any RFC 3339 offset and refuses a local time without one", () => {
    const body = { amount: { amount: "1200000", currency: "COP" } };
    expect(
      RecordExpenseBodySchema.safeParse({ ...body, occurredAt: "2026-10-16T14:32:00-05:00" }).success,
    ).toBe(true);
    expect(RecordExpenseBodySchema.safeParse({ ...body, occurredAt: "2026-10-16T19:32:00Z" }).success).toBe(
      true,
    );
    expect(RecordExpenseBodySchema.safeParse({ ...body, occurredAt: "2026-10-16T14:32:00" }).success).toBe(
      false,
    );
  });

  it("turns the instant into a Date and keeps the zone as sent", () => {
    expect(whenFromBody({ occurredAt: "2026-10-16T14:32:00-05:00", timeZone: "europe/madrid" })).toEqual({
      ok: true,
      value: { date: undefined, occurredAt: new Date("2026-10-16T19:32:00Z"), timeZone: "europe/madrid" },
    });
  });

  it("lets an explicit null through, for the use case to answer TimeRequired (P66)", () => {
    const body = { amount: { amount: "1200000", currency: "COP" } };
    expect(RecordExpenseBodySchema.safeParse({ ...body, occurredAt: null }).success).toBe(true);
    expect(whenFromBody({ occurredAt: null })).toEqual({
      ok: true,
      value: { date: undefined, occurredAt: null, timeZone: undefined },
    });
  });
});
