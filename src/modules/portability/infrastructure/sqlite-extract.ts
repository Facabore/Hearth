import { constants, DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";

export type Row = Record<string, unknown>;

/**
 * What a reader takes out of an uploaded SQLite file (design §3.5): the tables that must exist for the file to be
 * recognized, the tables that must not be views (so a crafted view cannot make a query run unbounded), and the
 * fixed read-only queries, by name. Every query is a constant of the reader, never anything from the file.
 */
export interface ExtractSpec {
  readonly required: readonly string[];
  readonly guarded: readonly string[];
  readonly queries: Readonly<Record<string, string>>;
}

/** The outcome of an extraction: every query's rows by name, or why there are none. */
export type Extracted =
  | { readonly kind: "rows"; readonly rows: Readonly<Record<string, Row[]>> }
  | { readonly kind: "notRecognized" }
  | { readonly kind: "unreadable"; readonly reason: string }
  | { readonly kind: "timedOut" };

/** Only reads: any write, ATTACH, PRAGMA, function call or recursive query in this connection is refused. */
const readOnlyAuthorizer = (actionCode: number): number =>
  actionCode === constants.SQLITE_SELECT || actionCode === constants.SQLITE_READ
    ? constants.SQLITE_OK
    : constants.SQLITE_DENY;

/**
 * In this thread: the bytes become an in-memory database (`deserialize`, never a file on disk) with extensions off,
 * the defensive flag on and the read-only authorizer; the recognition check runs before any query. `WORKER_SOURCE`
 * below does exactly the same in a worker; `sqlite-extract.test.ts` pins that both give the same answer.
 */
export const extractTables = (bytes: Uint8Array, spec: ExtractSpec): Extracted => {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(":memory:", { allowExtension: false, defensive: true });
    // `deserialize` copies the bytes into SQLite's own memory; the caller's buffer is never touched.
    db.deserialize(bytes);
    db.setAuthorizer(readOnlyAuthorizer);
    const master = db.prepare("SELECT name, type FROM sqlite_master").all() as Row[];
    const types = new Map(master.map((row) => [String(row.name).toUpperCase(), String(row.type)]));
    const recognized =
      spec.required.every((name) => types.get(name) === "table") &&
      spec.guarded.every((name) => types.get(name) !== "view");
    if (!recognized) return { kind: "notRecognized" };
    const rows: Record<string, Row[]> = {};
    for (const [name, sql] of Object.entries(spec.queries)) rows[name] = db.prepare(sql).all() as Row[];
    return { kind: "rows", rows };
  } catch (cause) {
    return { kind: "unreadable", reason: String(cause) };
  } finally {
    db?.close();
  }
};

/**
 * `extractTables` as a self-contained CommonJS worker program (design §3.5's time limit): plain JavaScript with no
 * import of ours, so it runs the same under vitest and in the standalone Next.js build, whatever bundles the rest.
 * Keep it a line-for-line twin of `extractTables`.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const { constants, DatabaseSync } = require("node:sqlite");
const { bytes, spec } = workerData;
let db = null;
let answer;
try {
  db = new DatabaseSync(":memory:", { allowExtension: false, defensive: true });
  db.deserialize(bytes);
  db.setAuthorizer((code) =>
    code === constants.SQLITE_SELECT || code === constants.SQLITE_READ ? constants.SQLITE_OK : constants.SQLITE_DENY,
  );
  const master = db.prepare("SELECT name, type FROM sqlite_master").all();
  const types = new Map(master.map((row) => [String(row.name).toUpperCase(), String(row.type)]));
  const recognized =
    spec.required.every((name) => types.get(name) === "table") &&
    spec.guarded.every((name) => types.get(name) !== "view");
  if (!recognized) {
    answer = { kind: "notRecognized" };
  } else {
    const rows = {};
    for (const [name, sql] of Object.entries(spec.queries)) rows[name] = db.prepare(sql).all();
    answer = { kind: "rows", rows };
  }
} catch (cause) {
  answer = { kind: "unreadable", reason: String(cause) };
} finally {
  if (db !== null) db.close();
}
parentPort.postMessage(answer);
`;

/**
 * `extractTables` in a `node:worker_threads` worker that is terminated after `timeoutMs` (design §3.5): a crafted file
 * whose reads take too long answers `timedOut` and never blocks the server's own thread. The bytes are copied to the
 * worker in memory; nothing is written to disk.
 */
export const extractInWorker = (
  bytes: Uint8Array,
  spec: ExtractSpec,
  timeoutMs: number,
): Promise<Extracted> =>
  new Promise((resolve) => {
    const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { bytes, spec } });
    let settled = false;
    const settle = (answer: Extracted) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(answer);
    };
    const timer = setTimeout(() => settle({ kind: "timedOut" }), timeoutMs);
    worker.once("message", (answer: Extracted) => settle(answer));
    worker.once("error", (cause) => settle({ kind: "unreadable", reason: String(cause) }));
    worker.once("exit", () => settle({ kind: "unreadable", reason: "worker exited" }));
  });
