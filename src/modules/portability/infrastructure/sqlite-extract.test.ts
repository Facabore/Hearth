import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { isErr } from "@/shared/kernel";
import { moneyManagerBackup } from "../../../../tests/support/money-manager-backup";
import { MONEY_MANAGER_READ, MoneyManagerAdapter } from "./money-manager-adapter";
import { extractInWorker, extractTables } from "./sqlite-extract";
import { createWorkerSnapshotReader } from "./worker-snapshot-reader";

const backup = moneyManagerBackup();

/** A file whose INOUTCOME is a view: refused before any query runs (design §3.5). */
const withView = (() => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE ASSETS (uid TEXT); CREATE VIEW INOUTCOME AS SELECT uid FROM ASSETS;");
  const bytes = db.serialize();
  db.close();
  return bytes;
})();

describe("the SQLite reads in a worker (design §3.5)", () => {
  it("gives exactly the rows the in-thread reader gives", async () => {
    const here = extractTables(backup, MONEY_MANAGER_READ);
    expect(here.kind).toBe("rows");
    expect(await extractInWorker(backup, MONEY_MANAGER_READ, 30_000)).toEqual(here);
  });

  it("builds the same snapshot as the adapter's own read", async () => {
    const direct = new MoneyManagerAdapter().read({ bytes: backup });
    expect(await createWorkerSnapshotReader().read(backup)).toEqual(direct);
    expect(isErr(direct)).toBe(false);
  });

  it("refuses the same files the same way: a view where a table belongs, and unreadable bytes", async () => {
    expect(extractTables(withView, MONEY_MANAGER_READ)).toEqual({ kind: "notRecognized" });
    expect(await extractInWorker(withView, MONEY_MANAGER_READ, 30_000)).toEqual({ kind: "notRecognized" });
    const garbage = new Uint8Array([1, 2, 3, 4]);
    expect(extractTables(garbage, MONEY_MANAGER_READ).kind).toBe("unreadable");
    expect((await extractInWorker(garbage, MONEY_MANAGER_READ, 30_000)).kind).toBe("unreadable");
  });

  it("answers ImportTimedOut when the reads outlast the limit", async () => {
    const read = await createWorkerSnapshotReader(0).read(backup);
    expect(isErr(read) && read.error.code).toBe("ImportTimedOut");
  });

  it("checks the size, zip and header before any worker starts", async () => {
    const zip = new Uint8Array([0x50, 0x4b, 3, 4]);
    const read = await createWorkerSnapshotReader().read(zip);
    expect(isErr(read) && read.error.code).toBe("ZipBackupNotSupported");
  });
});
