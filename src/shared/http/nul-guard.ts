import type { ProblemFieldError } from "./problem";

/** PostgreSQL `text` refuses U+0000 (SQLSTATE 22021), so no request may carry it in a string or a key. */
const NUL = "\u0000";

/** A problem lists at most this many offending paths, so a hostile body cannot inflate the response. */
export const MAX_NUL_ERRORS = 20;

/**
 * Issue 118: the paths (dotted like Zod's, arrays by index) of every string, and every object key, in a parsed
 * JSON value or query object that contains a NUL character. One guard for every free-text field of every route:
 * the contracts keep validating shape and length, never this.
 */
export const nulFieldErrors = (value: unknown): ProblemFieldError[] => {
  const errors: ProblemFieldError[] = [];
  const refuse = (path: string) => {
    if (errors.length < MAX_NUL_ERRORS) errors.push({ path, message: "Must not contain NUL characters" });
  };
  const join = (path: string, key: string) => (path === "" ? key : `${path}.${key}`);
  // An explicit stack, not recursion: a deeply nested body must not overflow the call stack.
  const pending: Array<readonly [unknown, string]> = [[value, ""]];
  while (pending.length > 0 && errors.length < MAX_NUL_ERRORS) {
    const [node, path] = pending.pop() as readonly [unknown, string];
    if (typeof node === "string") {
      if (node.includes(NUL)) refuse(path);
    } else if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) pending.push([node[i], join(path, String(i))]);
    } else if (typeof node === "object" && node !== null) {
      const entries = Object.entries(node);
      for (const [key] of entries) if (key.includes(NUL)) refuse(join(path, key));
      for (let i = entries.length - 1; i >= 0; i--) {
        const [key, child] = entries[i] as [string, unknown];
        pending.push([child, join(path, key)]);
      }
    }
  }
  return errors;
};
