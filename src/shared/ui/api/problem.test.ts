import { describe, expect, it } from "vitest";
import { fieldOf, problemFrom, type Problem } from "./problem";

const response = (status: number, requestId?: string) =>
  new Response(null, { status, headers: requestId ? { "x-request-id": requestId } : {} });

describe("problemFrom (HU-E9-02)", () => {
  it("keeps the code, request id, field errors and public field of a problem body", () => {
    const body = {
      type: "urn:hearth:problem:ValidationFailed",
      title: "Unprocessable Content",
      status: 422,
      code: "ValidationFailed",
      requestId: "req-1",
      errors: [{ path: "amount.amount", message: "Amount must be an integer string in minor units" }],
    };
    expect(problemFrom(body, response(422, "req-1"))).toEqual({
      code: "ValidationFailed",
      status: 422,
      requestId: "req-1",
      errors: [{ path: "amount.amount", message: "Amount must be an integer string in minor units" }],
      field: null,
    });
    expect(
      problemFrom({ ...body, code: "AccountAttributeNotAllowed", field: "monthlyRate" }, response(409)).field,
    ).toBe("monthlyRate");
  });

  it("keeps the public outstanding amount of OutstandingBalance and nothing malformed (ruling P163)", () => {
    const body = {
      code: "OutstandingBalance",
      status: 409,
      requestId: "r",
      outstanding: { amount: "10000000", currency: "COP" },
    };
    expect(problemFrom(body, response(409)).outstanding).toEqual({ amount: "10000000", currency: "COP" });
    expect(problemFrom({ ...body, outstanding: { amount: 5 } }, response(409))).not.toHaveProperty(
      "outstanding",
    );
    expect(
      problemFrom({ ...body, outstanding: { amount: 5, currency: "COP" } }, response(409)),
    ).not.toHaveProperty("outstanding");
    expect(problemFrom({ ...body, outstanding: { amount: "5" } }, response(409))).not.toHaveProperty(
      "outstanding",
    );
    expect(problemFrom({ code: "SpaceArchived" }, response(409))).not.toHaveProperty("outstanding");
  });

  it("reads anything else as Unknown, with the request id when the response has one", () => {
    expect(problemFrom("<html>502 Bad Gateway</html>", response(502, "req-2"))).toEqual({
      code: "Unknown",
      status: 502,
      requestId: "req-2",
      errors: [],
      field: null,
    });
    expect(problemFrom(new TypeError("Failed to fetch"), undefined)).toEqual({
      code: "Unknown",
      status: 0,
      requestId: null,
      errors: [],
      field: null,
    });
  });
});

describe("fieldOf (ruling P118)", () => {
  const problem = (code: string, extra: Partial<Problem> = {}): Problem => ({
    code,
    status: 422,
    requestId: "r",
    errors: [],
    field: null,
    ...extra,
  });
  const fields = ["name", "email", "password"] as const;
  const byCode = { EmailTaken: "email", PasswordTooShort: "password" } as const;

  it("puts a code next to its field, then a validation path, else on the form", () => {
    expect(fieldOf(problem("EmailTaken"), byCode, fields)).toBe("email");
    expect(
      fieldOf(
        problem("ValidationFailed", { errors: [{ path: "name", message: "Too small" }] }),
        byCode,
        fields,
      ),
    ).toBe("name");
    expect(
      fieldOf(
        problem("ValidationFailed", { errors: [{ path: "", message: "Body must be valid JSON" }] }),
        byCode,
        fields,
      ),
    ).toBe("form");
    expect(fieldOf(problem("TooManyRequests"), byCode, fields)).toBe("form");
  });
});
