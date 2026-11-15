import { randomInt } from "node:crypto";
import { REFERRAL_ALPHABET, REFERRAL_RANDOM_LENGTH, type ReferralRandom } from "../application";

/** D27: each character drawn uniformly from the alphabet by the operating system's cryptographic source. */
export const cryptoReferralRandom: ReferralRandom = {
  next: () =>
    Array.from(
      { length: REFERRAL_RANDOM_LENGTH },
      () => REFERRAL_ALPHABET[randomInt(REFERRAL_ALPHABET.length)],
    ).join(""),
};
