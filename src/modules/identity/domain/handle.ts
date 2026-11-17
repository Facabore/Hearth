import { domainError, err, ok, type Result } from "@/shared/kernel";

/** Ruling P339: an @usuario is 3–20 lower-case letters a–z, digits and underscores. */
export const MIN_HANDLE = 3;
export const MAX_HANDLE = 20;
const HANDLE = /^[a-z0-9_]{3,20}$/;

/**
 * Ruling P339: the handle as stored and compared, unique ignoring case. Surrounding spaces and one leading "@" are not
 * part of it, and upper case is read as lower case, so "@Fabian" is "fabian"; anything else outside the set is
 * InvalidHandle.
 */
export const parseHandle = (raw: string): Result<string> => {
  const trimmed = raw.trim();
  const handle = (trimmed.startsWith("@") ? trimmed.slice(1) : trimmed).toLowerCase();
  return HANDLE.test(handle) ? ok(handle) : err(domainError("InvalidHandle", { length: handle.length }));
};
