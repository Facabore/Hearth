import { describe, expect, it } from "vitest";
import { serverZone } from "./server-now";

describe("serverZone (ruling P182)", () => {
  it("reads the installation's zone for screens without a person", () => {
    expect(serverZone({ APP_TIMEZONE: "Europe/Madrid" })).toBe("Europe/Madrid");
    expect(serverZone({})).toBe("America/Bogota");
  });
});
