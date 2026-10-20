import { describe, expect, it } from "vitest";
import { problemFrom } from "./problem";

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
