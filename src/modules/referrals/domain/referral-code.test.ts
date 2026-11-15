import { describe, expect, it } from "vitest";
import {
  codePrefixOf,
  firstNameOf,
  parseReferralCode,
  referralCodeOf,
  REFERRAL_WINDOW_MS,
  withinReferralWindow,
} from "./referral-code";

describe("referral codes (D27)", () => {
  it("prefixes the random part with the first name, without accents or other characters", () => {
    expect(referralCodeOf("Fabián Bonilla", "7k2qx9mt")).toBe("fabian-7k2qx9mt");
    expect(referralCodeOf("  María-José  ", "7k2qx9mt")).toBe("mariajose-7k2qx9mt");
    expect(codePrefixOf("Maximiliano-Alejandro")).toBe("maximilianoa");
  });

  it("keeps only the random part when the name leaves no letter a–z", () => {
    expect(referralCodeOf("李", "7k2qx9mt")).toBe("7k2qx9mt");
    expect(referralCodeOf("   ", "7k2qx9mt")).toBe("7k2qx9mt");
  });

  it("reads a code case-insensitively and refuses anything that cannot be one", () => {
    expect(parseReferralCode(" Fabian-7K2QX9MT ")).toBe("fabian-7k2qx9mt");
    expect(parseReferralCode("7k2qx9mt")).toBe("7k2qx9mt");
    for (const bad of [
      "",
      "fabian",
      "fabian-7k2q",
      "fabian-7k2qx9mto",
      "fabian-7k2qx9m1",
      "../etc",
      "a b-7k2qx9mt",
    ])
      expect(parseReferralCode(bad)).toBeNull();
  });

  it("names a person by the first word of their name", () => {
    expect(firstNameOf("  Ana María Pérez ")).toBe("Ana");
    expect(firstNameOf("Juan")).toBe("Juan");
  });

  it("admits a claim strictly within 24 hours of the account's creation", () => {
    const created = new Date("2026-11-14T10:00:00Z");
    expect(withinReferralWindow(created, new Date(created.getTime() + REFERRAL_WINDOW_MS - 1))).toBe(true);
    expect(withinReferralWindow(created, new Date(created.getTime() + REFERRAL_WINDOW_MS))).toBe(false);
  });
});
