import { describe, expect, it } from "vitest";
import { isUuid } from "./id";

describe("isUuid", () => {
  it("accepts canonical UUIDs in either case", () => {
    expect(isUuid("0199d3a4-8c1e-7b2a-9f3e-1a2b3c4d5e6f")).toBe(true);
    expect(isUuid("3F2504E0-4F89-11D3-9A0C-0305E82C3301")).toBe(true);
  });

  it.each([
    "",
    "not-a-uuid",
    "0199d3a4-8c1e-7b2a-9f3e-1a2b3c4d5e6",
    "0199d3a4-8c1e-7b2a-9f3e-1a2b3c4d5e6fa",
    "'; DROP TABLE spaces; --",
  ])("rejects %j", (value) => {
    expect(isUuid(value)).toBe(false);
  });
});
