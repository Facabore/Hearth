import { describe, expect, it } from "vitest";
import type { Result } from "@/shared/kernel";
import { confirmBatch, draftSnapshot, NOTHING_CREATED, undoBatch, type ImportBatch } from "./import-batch";
import type { SourceSnapshot } from "./source-snapshot";

const snapshot = { sourceApp: "money-manager" } as SourceSnapshot;
const draft: ImportBatch = {
  id: "b1",
  spaceId: "s1",
  userId: "u1",
  sourceApp: "money-manager",
  fileSha256: "f",
  status: "DRAFT",
  snapshot,
  mappings: { timeZone: "UTC", accounts: {}, categories: {}, includeDuplicates: [] },
  counts: null,
  rowErrors: [],
  created: NOTHING_CREATED,
  createdAt: new Date("2026-11-16T00:00:00Z"),
  confirmedAt: null,
  undoneAt: null,
};
const outcome = {
  counts: {
    accountsCreated: 0,
    accountsRestored: 0,
    categoriesCreated: 0,
    categoriesRestored: 0,
    movementsImported: 0,
    alreadyImported: 0,
    duplicatesSkipped: 0,
    adjustmentsInOpeningBalance: 0,
    adjustmentsNotImported: 0,
    rowErrors: 0,
  },
  rowErrors: [],
  created: NOTHING_CREATED,
};
const now = new Date("2026-11-16T15:00:00Z");
const codeOf = (result: Result<unknown>) => (result.ok ? "ok" : result.error.code);

describe("an import batch's states (design §3.2)", () => {
  it("confirms a draft once, and never one already confirmed or undone (ImportNotDraft)", () => {
    expect(confirmBatch(draft, outcome, now)).toMatchObject({
      ok: true,
      value: { status: "CONFIRMED", confirmedAt: now },
    });
    expect(codeOf(confirmBatch({ ...draft, status: "CONFIRMED" }, outcome, now))).toBe("ImportNotDraft");
    expect(codeOf(confirmBatch({ ...draft, status: "UNDONE" }, outcome, now))).toBe("ImportNotDraft");
  });

  it("takes nothing more on a draft whose snapshot was removed (ImportSnapshotExpired)", () => {
    expect(codeOf(draftSnapshot({ ...draft, snapshot: null }))).toBe("ImportSnapshotExpired");
    expect(codeOf(confirmBatch({ ...draft, snapshot: null }, outcome, now))).toBe("ImportSnapshotExpired");
  });

  it("undoes only a confirmed batch (ImportNotConfirmed)", () => {
    expect(undoBatch({ ...draft, status: "CONFIRMED" }, now)).toMatchObject({
      ok: true,
      value: { status: "UNDONE", undoneAt: now },
    });
    expect(codeOf(undoBatch(draft, now))).toBe("ImportNotConfirmed");
    expect(codeOf(undoBatch({ ...draft, status: "UNDONE" }, now))).toBe("ImportNotConfirmed");
  });
});
