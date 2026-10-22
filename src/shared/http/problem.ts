export interface ProblemFieldError {
  readonly path: string;
  readonly message: string;
}

// Maps, not object literals, so inherited keys such as "constructor" never match.
const EXPLICIT: ReadonlyMap<string, number> = new Map([
  ["Unauthenticated", 401],
  ["InvalidCredentials", 401],
  ["InsufficientRole", 403],
  ["ValidationFailed", 422],
  ["NotASpaceMember", 422],
  ["UnknownCurrency", 422],
  ["CurrencyMismatch", 422],
  ["CategoryRequired", 422],
  ["AccountRequired", 422],
  ["PaymentsRequired", 422],
  ["ParticipantsRequired", 422],
  ["AccountNotOwned", 422],
  ["AccountNotInSpace", 422],
  ["SavingsAccountRequired", 422],
  ["CategoryNotInSpace", 422],
  // HU-E4-14: the request's date and instant disagree; the default would be 409.
  ["DateTimeMismatch", 422],
  // HU-E4-14, ruling P66: `occurredAt: null`; a time is replaced, never removed; the default would be 409.
  ["TimeRequired", 422],
  // HU-E6-07: the plan's state, not the request, refuses the move (ruling P12).
  ["InvalidPlanTransition", 409],
  // HU-E4-11: the recurrence's state, not the request, refuses the move (ruling P27).
  ["InvalidRecurrenceTransition", 409],
  // HU-E4-13: a confirm or a skip of an occurrence that is not PENDING any more lost the race to the other.
  ["OccurrenceNotPending", 409],
  ["InvitationEmailMismatch", 403],
  // Ruling P143: HEARTH_SIGN_UP=closed refuses a visitor without a usable invitation; the default would be 409.
  ["SignUpClosed", 403],
  ["PasswordTooShort", 422],
  ["EmailTaken", 409],
  // HU-E1-15: the installation rules lock the field; explicit, as the story asks.
  ["PreferenceLocked", 409],
  ["IdempotencyKeyConflict", 409],
  ["PreconditionFailed", 412],
  ["TooManyRequests", 429],
  ["InternalError", 500],
]);

const TITLES: ReadonlyMap<number, string> = new Map([
  [401, "Unauthenticated"],
  [403, "Forbidden"],
  [404, "Not Found"],
  [409, "Conflict"],
  [412, "Precondition Failed"],
  [422, "Unprocessable Content"],
  [429, "Too Many Requests"],
  [500, "Internal Server Error"],
]);

// RFC 9457 extension members: the only details a client ever sees, per code; all others stay in the log.
const PUBLIC_DETAILS: ReadonlyMap<string, readonly string[]> = new Map([
  ["OutstandingBalance", ["outstanding"]],
  ["InvalidAllocation", ["lineIds"]],
  // Ruling P248 (M6c): the label of the ACTIVE source plan a close waits for, e.g. "2026-11".
  ["SourcePlanOpen", ["sourcePeriod"]],
  // HU-E4-11: "creator" when a recurrence's creator, not the requester, is why a resume or an edit is refused.
  ["InsufficientRole", ["member"]],
  ["NotASpaceMember", ["member"]],
  // HU-E2-06: the term an account type refuses, as the key inside the body's `terms`; the stored key stays private.
  ["AccountAttributeNotAllowed", ["field"]],
  // Ruling P188: which part of the body the transaction's type keeps.
  ["FieldNotEditable", ["field"]],
]);

/** The details of `code` that are part of the API contract, e.g. the outstanding amount (HU-E1-08). */
export const publicDetailsOf = (
  code: string,
  details: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> =>
  Object.fromEntries(
    (PUBLIC_DETAILS.get(code) ?? [])
      .filter((key) => Object.hasOwn(details, key) && details[key] !== undefined)
      .map((key) => [key, details[key]]),
  );

/**
 * Issue 121: a domain `ValidationFailed` may name the request fields it refuses as `details.errors`, the same
 * `errors[]` a contract-level one carries. Only well-formed `{ path, message }` entries leave the server.
 */
export const publicFieldErrorsOf = (
  code: string,
  details: Readonly<Record<string, unknown>> = {},
): ProblemFieldError[] | undefined => {
  const listed = code === "ValidationFailed" && Object.hasOwn(details, "errors") ? details.errors : undefined;
  if (!Array.isArray(listed)) return undefined;
  const errors = (listed as unknown[]).flatMap((entry): ProblemFieldError[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const { path, message } = entry as Record<string, unknown>;
    return typeof path === "string" && typeof message === "string" ? [{ path, message }] : [];
  });
  return errors.length > 0 ? errors : undefined;
};

/** Spec section 8: explicit codes first, then naming conventions, then 409 for invariant violations. */
export const statusForCode = (code: string): number =>
  EXPLICIT.get(code) ?? (code.endsWith("NotFound") ? 404 : code.startsWith("Invalid") ? 422 : 409);

/**
 * RFC 9457 problem details. Carries the stable code, which clients translate, and the extension members
 * the code makes public (publicDetailsOf); the standard members always win over an extension.
 */
export const problemResponse = (
  code: string,
  requestId: string,
  errors?: ProblemFieldError[],
  extensions: Readonly<Record<string, unknown>> = {},
): Response => {
  const status = statusForCode(code);
  const body = {
    ...extensions,
    type: `urn:hearth:problem:${code}`,
    title: TITLES.get(status) ?? "Error",
    status,
    code,
    requestId,
    ...(errors ? { errors } : {}),
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json", "x-request-id": requestId },
  });
};
