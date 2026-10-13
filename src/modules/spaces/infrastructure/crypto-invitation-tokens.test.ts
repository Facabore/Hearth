import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cryptoInvitationTokens } from "./crypto-invitation-tokens";

describe("cryptoInvitationTokens (HU-E1-06)", () => {
  it("issues URL-safe tokens with 256 random bits together with their SHA-256 hash", () => {
    const { token, hash } = cryptoInvitationTokens.issue();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("never repeats a token", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => cryptoInvitationTokens.issue().token));
    expect(tokens.size).toBe(1000);
  });

  it("hashes a presented token the same way as at issue time", () => {
    const { token, hash } = cryptoInvitationTokens.issue();
    expect(cryptoInvitationTokens.hash(token)).toBe(hash);
    expect(cryptoInvitationTokens.hash("anything")).toMatch(/^[0-9a-f]{64}$/);
  });
});
