import { describe, expect, it } from "vitest";
import { cryptoHandleDigits } from "./crypto-handle-digits";

describe("cryptoHandleDigits (P343)", () => {
  it("draws 4 digits, keeping the leading zeros", () => {
    const draws = Array.from({ length: 500 }, () => cryptoHandleDigits.next());
    for (const digits of draws) expect(digits).toMatch(/^[0-9]{4}$/);
    expect(new Set(draws).size).toBeGreaterThan(1);
  });
});
