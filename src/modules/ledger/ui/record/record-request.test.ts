import { describe, expect, it } from "vitest";
import { recordFieldOf, requestOf, type RecordDraft } from "./record-request";

const draft = (overrides: Partial<RecordDraft> = {}): RecordDraft => ({
  kind: "EXPENSE",
  amount: "85.000",
  description: " Market ",
  category: { categoryId: "c-groceries", subcategoryId: null },
  accountId: "a-bank",
  toAccountId: null,
  when: { date: "2026-10-31", wall: { hour: 23, minute: 30 } },
  timeZone: "America/Bogota",
  ...overrides,
});

describe("requestOf (HU-E9-03, ruling P118)", () => {
  it("sends an expense with its local date, its instant and the recorder's zone", () => {
    expect(requestOf(draft(), "COP", "DOT_COMMA")).toEqual({
      ok: true,
      kind: "EXPENSE",
      body: {
        description: "Market",
        date: "2026-10-31",
        occurredAt: "2026-11-01T04:30:00.000Z",
        timeZone: "America/Bogota",
        categoryId: "c-groceries",
        amount: { amount: "8500000", currency: "COP" },
        accountId: "a-bank",
      },
    });
  });

  it("records a chosen subcategory, and nothing optional when nothing was chosen", () => {
    const sub = requestOf(
      draft({ category: { categoryId: "c-groceries", subcategoryId: "c-veg" } }),
      "COP",
      "DOT_COMMA",
    );
    expect(sub.ok && sub.body.categoryId).toBe("c-veg");
    const bare = requestOf(draft({ description: "  ", category: null }), "COP", "DOT_COMMA");
    expect(bare.ok && Object.keys(bare.body)).toEqual([
      "date",
      "occurredAt",
      "timeZone",
      "amount",
      "accountId",
    ]);
  });

  it("sends a transfer between two accounts without a category", () => {
    const transfer = requestOf(
      draft({
        kind: "TRANSFER",
        amount: "200000",
        description: "",
        accountId: "a-bank",
        toAccountId: "a-visa",
        when: { date: "2026-10-25", wall: { hour: 10, minute: 0 } },
      }),
      "COP",
      "DOT_COMMA",
    );
    expect(transfer).toEqual({
      ok: true,
      kind: "TRANSFER",
      body: {
        date: "2026-10-25",
        occurredAt: "2026-10-25T15:00:00.000Z",
        timeZone: "America/Bogota",
        amount: { amount: "20000000", currency: "COP" },
        sourceAccountId: "a-bank",
        destinationAccountId: "a-visa",
      },
    });
  });

  it("refuses to build what it cannot send, and leaves the rest to the API", () => {
    expect(requestOf(draft({ amount: "ochenta" }), "COP", "DOT_COMMA")).toEqual({
      ok: false,
      field: "amount",
    });
    expect(requestOf(draft({ accountId: null }), "COP", "DOT_COMMA")).toEqual({
      ok: false,
      field: "account",
    });
    expect(requestOf(draft({ kind: "TRANSFER", toAccountId: null }), "COP", "DOT_COMMA")).toEqual({
      ok: false,
      field: "toAccount",
    });
    expect(requestOf(draft({ amount: "0" }), "COP", "DOT_COMMA").ok).toBe(true);
  });

  it("puts each API code next to its field", () => {
    const p = (code: string, errors: { path: string; message: string }[] = []) => ({
      code,
      status: 422,
      requestId: "r",
      errors,
      field: null,
    });
    expect(recordFieldOf(p("InvalidAmount"))).toBe("amount");
    expect(recordFieldOf(p("CategoryArchived"))).toBe("category");
    expect(recordFieldOf(p("AccountArchived"))).toBe("account");
    expect(recordFieldOf(p("SameAccountTransfer"))).toBe("toAccount");
    expect(recordFieldOf(p("DateTimeMismatch"))).toBe("when");
    expect(recordFieldOf(p("ValidationFailed", [{ path: "destinationAccountId", message: "x" }]))).toBe(
      "toAccount",
    );
    expect(recordFieldOf(p("IdempotencyKeyConflict"))).toBe("form");
  });
});

describe("recordFieldOf maps every code the record endpoints answer (HU-E9-03, ruling P118)", () => {
  const problem = (code: string, path?: string) => ({
    code,
    status: 422,
    requestId: "r",
    errors: path === undefined ? [] : [{ path, message: "x" }],
    field: null,
  });

  it.each([
    ["InvalidAmount", "amount"],
    ["CurrencyMismatch", "amount"],
    ["UnknownCurrency", "amount"],
    ["CategoryRequired", "category"],
    ["CategoryNotInSpace", "category"],
    ["CategoryArchived", "category"],
    ["AccountRequired", "account"],
    ["AccountArchived", "account"],
    ["AccountNotOwned", "account"],
    ["AccountNotInSpace", "account"],
    ["SameAccountTransfer", "toAccount"],
    ["InvalidDescription", "description"],
    ["InvalidDate", "when"],
    ["DateTimeMismatch", "when"],
    ["TimeRequired", "when"],
    ["InvalidTimeZone", "when"],
    ["PeriodClosed", "when"],
    ["IdempotencyKeyConflict", "form"],
    ["SomethingTheUiDoesNotKnow", "form"],
  ])("%s is shown at %s", (code, field) => {
    expect(recordFieldOf(problem(code))).toBe(field);
  });

  it.each([
    ["amount.amount", "amount"],
    ["description", "description"],
    ["categoryId", "category"],
    ["accountId", "account"],
    ["sourceAccountId", "account"],
    ["destinationAccountId", "toAccount"],
    ["date", "when"],
    ["occurredAt", "when"],
    ["timeZone", "when"],
    ["somethingElse", "form"],
  ])("a ValidationFailed on %s is shown at %s", (path, field) => {
    expect(recordFieldOf(problem("ValidationFailed", path))).toBe(field);
  });

  it("shows a ValidationFailed without a path above the button", () => {
    expect(recordFieldOf(problem("ValidationFailed"))).toBe("form");
  });
});
