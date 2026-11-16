import { describe, expect, it, vi } from "vitest";
import { domainError, err } from "@/shared/kernel";
import { createExportReader, type ExportReaderDeps } from "./export-reader";

describe("ExportReader.movements (D9)", () => {
  it("reads no movement of a space the caller cannot read, whatever the caller read before", async () => {
    const list = vi.fn(async () => []);
    const deps = {
      listMembers: async () => err(domainError("SpaceNotFound")),
      transactions: { list },
    } as unknown as ExportReaderDeps;
    const read = await createExportReader(deps).movements("space-1", "user-1");
    expect(!read.ok && read.error.code).toBe("SpaceNotFound");
    expect(list).not.toHaveBeenCalled();
  });
});
