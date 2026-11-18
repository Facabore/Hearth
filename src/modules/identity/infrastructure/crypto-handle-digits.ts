import { randomInt } from "node:crypto";
import { HANDLE_DIGITS, type HandleDigits } from "../application";

/** Ruling P343: the digits of a new account's handle, drawn uniformly by the operating system's cryptographic source. */
export const cryptoHandleDigits: HandleDigits = {
  next: () => String(randomInt(10 ** HANDLE_DIGITS)).padStart(HANDLE_DIGITS, "0"),
};
