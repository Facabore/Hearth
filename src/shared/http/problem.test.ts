import { describe, expect, it } from "vitest";
import { problemResponse, statusForCode } from "./problem";

describe("statusForCode", () => {
  it.each([
    ["InsufficientRole", 403],
    ["InvalidAmount", 422],
    ["SpaceNotFound", 404],
    ["OutstandingBalance", 409],
    ["PeriodClosed", 409],
    ["Unauthenticated", 401],
    ["InvalidCredentials", 401],
    ["NotASpaceMember", 422],
    ["UnknownCurrency", 422],
    ["CurrencyMismatch", 422],
    ["CategoryRequired", 422],
    ["AccountNotOwned", 422],
    ["AccountNotInSpace", 422],
    ["InvitationEmailMismatch", 403],
    ["InvitationNotFound", 404],
    ["MemberNotFound", 404],
    ["InvalidInvitationRole", 422],
    ["InvalidMemberName", 422],
    ["InvalidSpaceName", 422],
    ["AlreadyMember", 409],
    ["InvitationExpired", 409],
    ["InvitationRevoked", 409],
    ["InvitationAlreadyUsed", 409],
    ["LastOwnerRequired", 409],
    ["GuestHasNoRole", 409],
    ["MemberNameTaken", 409],
    ["PersonalSpaceAlreadyExists", 409],
    ["PersonalSpaceNotShareable", 409],
    ["SameAccountTransfer", 409],
    ["AccountArchived", 409],
    ["ValidationFailed", 422],
    ["PreconditionFailed", 412],
    ["TooManyRequests", 429],
    ["InternalError", 500],
  ])("maps %s to %i", (code, status) => {
    expect(statusForCode(code)).toBe(status);
  });

  it.each(["constructor", "toString", "__proto__"])(
    "treats the inherited key %s as an ordinary code",
    (code) => {
      expect(statusForCode(code)).toBe(409);
    },
  );
});

describe("problemResponse", () => {
  it("builds an RFC 9457 body with code and requestId", async () => {
    const response = problemResponse("SpaceNotFound", "req-1");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(response.headers.get("x-request-id")).toBe("req-1");
    expect(await response.json()).toEqual({
      type: "urn:hearth:problem:SpaceNotFound",
      title: "Not Found",
      status: 404,
      code: "SpaceNotFound",
      requestId: "req-1",
    });
  });

  it("includes field errors only when given", async () => {
    const response = problemResponse("ValidationFailed", "req-2", [{ path: "amount", message: "Required" }]);
    expect(await response.json()).toMatchObject({
      status: 422,
      errors: [{ path: "amount", message: "Required" }],
    });
  });
});
