// Client-safe readers of API answers, shared by the server containers (server.ts) and the single-page app (ADR 0006).
import type { SignUpMode } from "./dto";
import { problemFrom, type Problem } from "./problem";

export type Outcome<T> =
  | { kind: "ok"; data: T }
  | { kind: "unauthenticated" }
  | { kind: "missing" }
  | { kind: "problem"; problem: Problem };

export const outcomeOf = <T>(result: { data?: T; error?: unknown; response: Response }): Outcome<T> => {
  if (result.response.status === 401) return { kind: "unauthenticated" };
  if (result.response.status === 404) return { kind: "missing" };
  if (result.error !== undefined || result.data === undefined)
    return { kind: "problem", problem: problemFrom(result.error, result.response) };
  return { kind: "ok", data: result.data };
};

/**
 * The profile answer as the signed-in person, or null on a 401. Any other failure throws to the error page: reading
 * it as "signed out" would send a signed-in person to the sign-in screen, which sends them back (ruling P145).
 */
export const meFrom = <T>(result: { data?: T; error?: unknown; response: Response }): T | null => {
  const outcome = outcomeOf(result);
  if (outcome.kind === "ok") return outcome.data;
  if (outcome.kind === "unauthenticated") return null;
  const code = outcome.kind === "problem" ? outcome.problem.code : "NotFound";
  throw new Error(`Reading the profile failed: ${code}`);
};

/**
 * Ruling P143: closed only when the API says so. A failed read must not take the sign-in screen down, so it answers
 * open; the sign-up call answers `SignUpClosed` by itself when the installation is closed.
 */
export const signUpModeFrom = (result: {
  data?: { signUp: SignUpMode };
  error?: unknown;
  response: Response;
}): SignUpMode => (result.data?.signUp === "closed" ? "closed" : "open");

/** A query string shaped as Next hands it to a page: a repeated name is a list. */
export const searchRecordOf = (query: string): Record<string, string | string[]> => {
  const search: Record<string, string | string[]> = {};
  for (const [name, value] of new URLSearchParams(query)) {
    const seen = search[name];
    search[name] = seen === undefined ? value : [...(Array.isArray(seen) ? seen : [seen]), value];
  }
  return search;
};
