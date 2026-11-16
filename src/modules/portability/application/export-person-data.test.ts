import { describe, expect, it } from "vitest";
import { domainError, err, FixedClock, ok } from "@/shared/kernel";
import { createExportPersonData, type ExportReader, type ExportSpaceSummary } from "./export-person-data";

const personal: ExportSpaceSummary = {
  id: "space-ana",
  name: "Ana",
  kind: "PERSONAL",
  currency: "COP",
  periodPolicy: { kind: "MONTHLY", day: 1 },
  role: "OWNER",
  archived: false,
};

const reader = (spacesOf: ExportReader["spacesOf"]): ExportReader => ({
  spacesOf,
  members: async () => ok([]),
  accounts: async () => ok([]),
  categories: async () => ok([]),
  movements: async () => ok([]),
  recurrences: async () => ok([]),
  plans: async () => ok([]),
});

const exporter = (spacesOf: ExportReader["spacesOf"], limit = 1) => {
  const hits = new Map<string, number>();
  return createExportPersonData({
    reader: reader(spacesOf),
    archive: () => new Uint8Array(),
    throttle: {
      allows: (userId) => {
        hits.set(userId, (hits.get(userId) ?? 0) + 1);
        return hits.get(userId)! <= limit;
      },
    },
    clock: new FixedClock(new Date("2026-11-01T03:00:00Z")),
    userTimeZones: { timeZoneOf: async () => "America/Bogota" },
  });
};

const ana = { id: "u-ana", name: "Ana", locale: "es" };

describe("ExportPersonData (design §3.6)", () => {
  it("passes on a failed read of the person's spaces instead of answering SpaceNotFound", async () => {
    const run = exporter(async () => err(domainError("SpacesUnavailable")));

    const result = await run({ user: ana, format: "json" });

    expect(result).toEqual(err(domainError("SpacesUnavailable")));
  });

  it("answers SpaceNotFound for a space that is not one of the person's, without spending an export", async () => {
    const run = exporter(async () => ok([personal]));

    expect(await run({ user: ana, format: "json", spaceId: "space-juan" })).toEqual(
      err(domainError("SpaceNotFound")),
    );
    const exported = await run({ user: ana, format: "json" });
    expect(exported.ok && exported.value.format).toBe("json");
    expect(await run({ user: ana, format: "json" })).toEqual(err(domainError("TooManyRequests")));
  });
});
