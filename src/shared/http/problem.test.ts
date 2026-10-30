import { describe, expect, it } from "vitest";
import { problemResponse, publicDetailsOf, publicFieldErrorsOf, statusForCode } from "./problem";

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
    ["InvalidSettlementParties", 422],
    ["SettlementHasNoCategory", 409],
    ["InvalidFundAccount", 422],
    ["MixedFundPayment", 409],
    ["AccountRequired", 422],
    ["PaymentsRequired", 422],
    ["ParticipantsRequired", 422],
    ["InvalidSplit", 422],
    ["SharesDoNotMatchAmount", 409],
    ["GuestHasNoAccounts", 409],
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
    ["NotAGuest", 409],
    ["GuestAlreadyClaimed", 409],
    ["MemberNameTaken", 409],
    ["PersonalSpaceAlreadyExists", 409],
    ["PersonalSpaceNotShareable", 409],
    ["SpaceArchived", 409],
    ["PersonalSpaceNotArchivable", 409],
    ["DirectSpaceIsFull", 409],
    ["DirectSpaceMembersFixed", 409],
    ["InvalidDirectCounterpart", 422],
    ["BudgetPlanNotFound", 404],
    ["BudgetLineNotFound", 404],
    ["PlanAlreadyExists", 409],
    ["NoPreviousPlan", 409],
    ["InvalidCapacity", 422],
    ["PlanExceedsCapacity", 409],
    ["InvalidBudgetLineName", 422],
    ["InvalidPlannedAmount", 422],
    ["SavingsAccountRequired", 422],
    ["InvalidSavingsAccount", 422],
    ["SavingsAccountAlreadyUsed", 409],
    ["BudgetLineNameTaken", 409],
    ["CatchAllLineAlreadySet", 409],
    ["SavingsLineNotMappable", 409],
    ["InvalidAllocation", 422],
    ["ViewerCannotHoldCapacity", 422],
    ["ViewerCannotHoldAllocation", 422],
    ["InvalidPlanTransition", 409],
    ["InvalidRecurrenceTransition", 409],
    ["RecurrenceNotFound", 404],
    ["RecurrenceEnded", 409],
    ["InvalidRecurrence", 422],
    ["OccurrenceNotFound", 404],
    ["OccurrenceNotPending", 409],
    ["InvalidOccurrenceDate", 422],
    ["PeriodNotOver", 409],
    ["SourcePlanOpen", 409],
    ["CategoryNotInSpace", 422],
    ["CategoryAlreadyMapped", 409],
    ["SameAccountTransfer", 409],
    ["SameTransactionType", 422],
    ["TransactionNotConvertible", 409],
    ["TransactionNotConverted", 409],
    ["ConversionSuperseded", 409],
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

describe("public details (HU-E1-08)", () => {
  it("adds the outstanding amount of OutstandingBalance as an extension member, and no other detail", async () => {
    const details = publicDetailsOf("OutstandingBalance", {
      outstanding: { amount: "15000000", currency: "COP" },
      memberId: "m-1",
    });
    expect(details).toEqual({ outstanding: { amount: "15000000", currency: "COP" } });
    expect(await problemResponse("OutstandingBalance", "req-3", undefined, details).json()).toEqual({
      type: "urn:hearth:problem:OutstandingBalance",
      title: "Conflict",
      status: 409,
      code: "OutstandingBalance",
      requestId: "req-3",
      outstanding: { amount: "15000000", currency: "COP" },
    });
  });

  it("adds the source period of SourcePlanOpen as an extension member, and no other detail (ruling P248 of M6c)", async () => {
    const details = publicDetailsOf("SourcePlanOpen", { sourcePeriod: "2026-11", planId: "plan-1" });
    expect(details).toEqual({ sourcePeriod: "2026-11" });
    expect(await problemResponse("SourcePlanOpen", "req-5", undefined, details).json()).toEqual({
      type: "urn:hearth:problem:SourcePlanOpen",
      title: "Conflict",
      status: 409,
      code: "SourcePlanOpen",
      requestId: "req-5",
      sourcePeriod: "2026-11",
    });
  });

  it("keeps the details of every other code private", () => {
    expect(publicDetailsOf("InvalidSplit", { reason: "duplicatePayer" })).toEqual({});
    expect(publicDetailsOf("OutstandingBalance")).toEqual({});
  });

  it("picks only own, defined details: never an inherited key or an undefined value", () => {
    const inherited = Object.create({ outstanding: { amount: "1", currency: "COP" } });
    expect(Object.keys(publicDetailsOf("OutstandingBalance", inherited))).toEqual([]);
    expect(Object.keys(publicDetailsOf("OutstandingBalance", { outstanding: undefined }))).toEqual([]);
  });

  it("never lets an extension member replace a standard one", async () => {
    const response = problemResponse("SpaceNotFound", "req-4", undefined, { code: "Other", status: 200 });
    expect(await response.json()).toMatchObject({ code: "SpaceNotFound", status: 404 });
  });

  it("names the member a recurrence's resume or edit is refused for: its creator, not the requester (HU-E4-11)", async () => {
    expect([
      publicDetailsOf("InsufficientRole", { member: "creator" }),
      publicDetailsOf("NotASpaceMember", { member: "creator", memberId: "m-1" }),
      publicDetailsOf("InsufficientRole"),
      publicDetailsOf("AccountNotOwned", { member: "creator" }),
    ]).toEqual([{ member: "creator" }, { member: "creator" }, {}, {}]);
    const response = problemResponse("NotASpaceMember", "req-5", undefined, { member: "creator" });
    expect(await response.json()).toEqual({
      type: "urn:hearth:problem:NotASpaceMember",
      title: "Unprocessable Content",
      status: 422,
      code: "NotASpaceMember",
      requestId: "req-5",
      member: "creator",
    });
  });

  it("names the part of the body a transaction's type keeps, and answers 409 (ruling P188)", async () => {
    expect(publicDetailsOf("FieldNotEditable", { field: "payments", transactionId: "tx-1" })).toEqual({
      field: "payments",
    });
    expect(statusForCode("FieldNotEditable")).toBe(409);
    expect(
      await problemResponse("FieldNotEditable", "req-6", undefined, { field: "accountId" }).json(),
    ).toMatchObject({ code: "FieldNotEditable", status: 409, field: "accountId" });
  });

  it("names the flagged lines of an InvalidAllocation, and none of AllocateBudgetLine's reasons (HU-E6-07)", () => {
    expect(publicDetailsOf("InvalidAllocation", { lineIds: ["line-free"] })).toEqual({
      lineIds: ["line-free"],
    });
    expect(publicDetailsOf("InvalidAllocation", { reason: "percentNotHundred" })).toEqual({});
  });

  it("names the field an account type refuses, in its public form, and never the stored attribute (HU-E2-06)", async () => {
    const details = publicDetailsOf("AccountAttributeNotAllowed", {
      field: "monthlyRate",
      attribute: "monthlyRatePpm",
    });
    expect(details).toEqual({ field: "monthlyRate" });
    expect(publicDetailsOf("AccountAttributeNotAllowed", { attribute: "monthlyRatePpm" })).toEqual({});
    expect(publicDetailsOf("InvalidSplit", { field: "monthlyRate" })).toEqual({});
    expect(await problemResponse("AccountAttributeNotAllowed", "req-6", undefined, details).json()).toEqual({
      type: "urn:hearth:problem:AccountAttributeNotAllowed",
      title: "Conflict",
      status: 409,
      code: "AccountAttributeNotAllowed",
      requestId: "req-6",
      field: "monthlyRate",
    });
  });
});

describe("public field errors (issue 121)", () => {
  it("passes the well-formed entries of a ValidationFailed's errors detail, and nothing else", () => {
    expect(
      publicFieldErrorsOf("ValidationFailed", {
        errors: [{ path: "color", message: "Refused", extra: 1 }, { path: 1, message: "x" }, null, "icon"],
      }),
    ).toEqual([{ path: "color", message: "Refused" }]);
  });

  it("names no field for another code, a missing or malformed detail, or an empty list", () => {
    const errors = [{ path: "icon", message: "Refused" }];
    expect(publicFieldErrorsOf("InvalidSplit", { errors })).toBeUndefined();
    expect(publicFieldErrorsOf("ValidationFailed")).toBeUndefined();
    expect(publicFieldErrorsOf("ValidationFailed", { field: "style" })).toBeUndefined();
    expect(publicFieldErrorsOf("ValidationFailed", { errors: "icon" })).toBeUndefined();
    expect(publicFieldErrorsOf("ValidationFailed", { errors: [] })).toBeUndefined();
    expect(publicFieldErrorsOf("ValidationFailed", Object.create({ errors }))).toBeUndefined();
  });
});

describe("statusForCode (HU-E1-14, HU-E4-14)", () => {
  it.each([
    ["DateTimeMismatch", 422],
    ["TimeRequired", 422],
    ["InvalidTimeZone", 422],
  ])("maps %s to %i", (code, status) => {
    expect(statusForCode(code)).toBe(status);
  });
});

describe("statusForCode (HU-E1-15)", () => {
  it("maps PreferenceLocked to 409", () => {
    expect(statusForCode("PreferenceLocked")).toBe(409);
  });
});
