import { domainError, err, ok, type Result } from "@/shared/kernel";

// Versions are PostgreSQL integers; nine digits keep them well inside the column range.
const STRONG_VERSION = /^"(\d{1,9})"$/;

export const etagOf = (version: number): string => `"${version}"`;

/** Reads `If-Match: "<version>"`; absent -> null, malformed -> PreconditionFailed. */
export const ifMatchVersion = (request: Request): Result<number | null> => {
  const header = request.headers.get("if-match");
  if (header === null) return ok(null);
  const version = header.trim().match(STRONG_VERSION)?.[1];
  return version === undefined ? err(domainError("PreconditionFailed")) : ok(Number(version));
};
