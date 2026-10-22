import type { MoneyDto } from "./dto";

/** HU-E9-02: what the UI knows of a failed call: a stable code to translate, never a raw message or a stack. */
export interface Problem {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly errors: readonly { path: string; message: string }[];
  readonly field: string | null;
  /** Ruling P163: the public `outstanding` member of OutstandingBalance; absent for every other problem. */
  readonly outstanding?: MoneyDto;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A `problem+json` body keeps its code, request id, field errors and public field; anything else (an HTML 502 from
 * the proxy, a rejected `fetch` offline) is `Unknown`, with the response's `x-request-id` when there is one.
 */
export const problemFrom = (error: unknown, response: Response | undefined): Problem => {
  const headerId = response?.headers.get("x-request-id") ?? null;
  if (isRecord(error) && typeof error.code === "string" && error.code !== "") {
    const outstanding = error.outstanding;
    const money =
      isRecord(outstanding) &&
      typeof outstanding.amount === "string" &&
      typeof outstanding.currency === "string"
        ? { outstanding: { amount: outstanding.amount, currency: outstanding.currency } }
        : {};
    return {
      code: error.code,
      status: typeof error.status === "number" ? error.status : (response?.status ?? 0),
      requestId: typeof error.requestId === "string" ? error.requestId : headerId,
      errors: Array.isArray(error.errors) ? (error.errors as Problem["errors"]) : [],
      field: typeof error.field === "string" ? error.field : null,
      ...money,
    };
  }
  return { code: "Unknown", status: response?.status ?? 0, requestId: headerId, errors: [], field: null };
};

/**
 * Ruling P118: where a problem is shown: the field its code names, else the first segment of the first validation
 * path when it names a field, else the problem's public field when it names one, else the form.
 */
export const fieldOf = <F extends string>(
  problem: Problem,
  byCode: Readonly<Partial<Record<string, F>>>,
  fields: readonly F[],
): F | "form" => {
  const isField = (name: string | null | undefined): name is F => fields.includes(name as F);
  const byItsCode = byCode[problem.code];
  if (byItsCode !== undefined) return byItsCode;
  const fromPath = problem.errors[0]?.path.split(".")[0];
  if (isField(fromPath)) return fromPath;
  return isField(problem.field) ? problem.field : "form";
};
