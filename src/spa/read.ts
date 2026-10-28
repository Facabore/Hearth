import { isNotFound, notFound } from "@tanstack/react-router";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { outcomeOf } from "@/shared/ui/api/readers";

/** A read the API refused: the screen shows its problem in place (P118's messages), as the Next.js containers do. */
export class ProblemError extends Error {
  constructor(readonly problem: Problem) {
    super(`The API refused a read: ${problem.code}`);
    this.name = "ProblemError";
  }
}

/** A failure that may pass a moment later: the network, or the server itself (5xx), such as during a release. */
export const isTransient = (error: unknown): boolean =>
  error instanceof ProblemError ? error.problem.status >= 500 : !isNotFound(error);

/**
 * A screen's read as a query function (ADR 0006): the data, a 404 as the route's not-found screen (N1), any other
 * refusal as a `ProblemError`. A 401 has already sent the person to sign in (P151); a network failure throws as it is,
 * which the error screen answers with "connection".
 */
export const read = async <T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> => {
  const result = await call;
  const outcome = outcomeOf(result);
  if (outcome.kind === "ok") return outcome.data;
  if (outcome.kind === "missing") throw notFound();
  throw new ProblemError(problemFrom(result.error, result.response));
};
