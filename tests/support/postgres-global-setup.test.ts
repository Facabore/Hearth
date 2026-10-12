import { describe, expect, it } from "vitest";
import { adminUrlOf, parsePublishedPort } from "./postgres-global-setup";

describe("parsePublishedPort", () => {
  it.each([
    ["127.0.0.1:49153", "49153"],
    ["0.0.0.0:5000\n[::]:5000", "5000"],
  ])("reads the host port from %j", (output, port) => {
    expect(parsePublishedPort(output)).toBe(port);
  });

  it.each(["", "garbage", "127.0.0.1:"])("rejects a missing mapping %j", (output) => {
    expect(() => parsePublishedPort(output)).toThrow(/No published port/);
  });
});

describe("adminUrlOf", () => {
  it("points at the maintenance database of the same server", () => {
    expect(adminUrlOf("postgres://u:p@h:5432/hearth")).toBe("postgres://u:p@h:5432/postgres");
  });
});
