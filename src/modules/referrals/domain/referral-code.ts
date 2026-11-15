/**
 * D27: a person's referral code, shared as `/r/<code>`. A readable prefix from the first name, then eight characters
 * drawn at random from an alphabet with no look-alikes (no 0/o, 1/i/l), all lower case and URL-safe: 31^8, about
 * 8.5 × 10^11 codes per prefix, so a code cannot be guessed.
 */
export const REFERRAL_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const REFERRAL_RANDOM_LENGTH = 8;
const PREFIX_MAX = 12;

const CODE = new RegExp(`^(?:[a-z]{1,${PREFIX_MAX}}-)?[${REFERRAL_ALPHABET}]{${REFERRAL_RANDOM_LENGTH}}$`);

/** D27: what the referrer is called on a link and in a list: the first word of the name they signed up with. */
export const firstNameOf = (name: string): string => name.trim().split(/\s+/)[0] ?? "";

/** The code's readable part: the first name without accents, lower-cased, letters a–z only; empty when none remain. */
export const codePrefixOf = (name: string): string =>
  firstNameOf(name)
    .normalize("NFD")
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .slice(0, PREFIX_MAX);

/** `random` must be REFERRAL_RANDOM_LENGTH characters of REFERRAL_ALPHABET. */
export const referralCodeOf = (name: string, random: string): string => {
  const prefix = codePrefixOf(name);
  return prefix === "" ? random : `${prefix}-${random}`;
};

/**
 * A code as typed or linked, lower-cased; null when it cannot be one. A malformed code and an unknown one answer the
 * same (D27), so this only spares the database a read.
 */
export const parseReferralCode = (raw: string): string | null => {
  const code = raw.trim().toLowerCase();
  return CODE.test(code) ? code : null;
};

/** D27: an account is a referral only when its claim arrives within 24 hours of its creation. */
export const REFERRAL_WINDOW_MS = 24 * 60 * 60 * 1000;

export const withinReferralWindow = (accountCreatedAt: Date, now: Date): boolean =>
  now.getTime() - accountCreatedAt.getTime() < REFERRAL_WINDOW_MS;
