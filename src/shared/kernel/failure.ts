/** What is safe to log about a thrown value: see `failureOf`. */
export interface FailureDetail {
  /** The error's name. */
  readonly error: string;
  /** The SQLSTATE of the database error behind it, when there is one. */
  readonly code?: string;
  /** The constraint that database error names, when it names one. */
  readonly constraint?: string;
}

/**
 * What is safe to say about a thrown error: its name and, when it carries a database error (Drizzle wraps the driver's
 * as the `cause`), its SQLSTATE and constraint. Never the message, the query or its parameters, which can carry
 * personal data. Used wherever a job reports a failure it did not expect.
 */
export const failureOf = (error: unknown): FailureDetail => {
  if (!(error instanceof Error)) return { error: "NonErrorThrown" };
  const { code, constraint } = (error.cause ?? error) as { code?: unknown; constraint?: unknown };
  return {
    error: error.name,
    ...(typeof code === "string" ? { code } : {}),
    ...(typeof constraint === "string" ? { constraint } : {}),
  };
};
