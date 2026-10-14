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
  ["InvitationEmailMismatch", 403],
  ["PasswordTooShort", 422],
  ["EmailTaken", 409],
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

/** Spec section 8: explicit codes first, then naming conventions, then 409 for invariant violations. */
export const statusForCode = (code: string): number =>
  EXPLICIT.get(code) ?? (code.endsWith("NotFound") ? 404 : code.startsWith("Invalid") ? 422 : 409);

/** RFC 9457 problem details. Carries only the stable code; clients translate it. */
export const problemResponse = (code: string, requestId: string, errors?: ProblemFieldError[]): Response => {
  const status = statusForCode(code);
  const body = {
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
