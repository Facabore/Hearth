import { describe, expect, it } from "vitest";
import { failureOf } from "./failure";

describe("failureOf", () => {
  it("names a plain Error and nothing else, never its message", () => {
    expect(failureOf(new TypeError("select * from users where email = 'ana@example.com'"))).toEqual({
      error: "TypeError",
    });
  });

  it("adds the SQLSTATE and constraint of the database error in its cause", () => {
    const cause = Object.assign(new Error("duplicate key value (a@b.co)"), {
      code: "23505",
      constraint: "occurrences_recurrence_date_key",
    });
    expect(failureOf(new Error("Failed query", { cause }))).toEqual({
      error: "Error",
      code: "23505",
      constraint: "occurrences_recurrence_date_key",
    });
  });

  it("reads the code and constraint of the error itself when it has no cause, and ignores non-string ones", () => {
    expect(failureOf(Object.assign(new Error("x"), { code: "57P01" }))).toEqual({
      error: "Error",
      code: "57P01",
    });
    expect(failureOf(Object.assign(new Error("x"), { code: 42, constraint: {} }))).toEqual({
      error: "Error",
    });
  });

  it("names a thrown value that is no Error as NonErrorThrown", () => {
    expect(failureOf("boom")).toEqual({ error: "NonErrorThrown" });
    expect(failureOf(undefined)).toEqual({ error: "NonErrorThrown" });
  });
});
