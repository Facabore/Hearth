import { describe, expect, it } from "vitest";
import { allTimeZones, zoneCity, zoneOffset } from "./zones";

describe("time zone labels (HU-E9-13)", () => {
  it("names a zone by its city and its offset at an instant", () => {
    expect(zoneCity("America/Bogota")).toBe("Bogota");
    expect(zoneCity("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(zoneOffset("America/Bogota", new Date("2026-10-16T12:00:00Z"))).toBe("GMT-5");
    expect(zoneOffset("UTC", new Date("2026-10-16T12:00:00Z"))).toBe("GMT");
  });

  it("lists the IANA zones the runtime knows, Bogotá among them", () => {
    expect(allTimeZones()).toContain("America/Bogota");
  });
});
