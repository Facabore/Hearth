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

/** Ruling P343: how many random digits follow the name in a handle given at sign-up. */
export const HANDLE_DIGITS = 4;
const STEM_MAX = 10;
const STEM_MIN = 3;
const FALLBACK_STEM = "hearth";

/**
 * Ruling P343: the handle a new account is given, before the person picks one: the name with its accents dropped, kept
 * to a–z and 0–9 in lower case and cut to 10 characters (`hearth` when fewer than 3 remain), then `_` and `digits`
 * (HANDLE_DIGITS random digits), e.g. "Fabián" and "4821" make "fabian_4821". Always passes `parseHandle`.
 */
export const handleCandidate = (name: string, digits: string): string => {
  const stem = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, STEM_MAX);
  return `${stem.length >= STEM_MIN ? stem : FALLBACK_STEM}_${digits}`;
};
