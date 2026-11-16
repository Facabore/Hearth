import type { Result } from "@/shared/kernel";
import type { SourceSnapshot } from "../domain/source-snapshot";

/**
 * An uploaded file, as its bytes. The file is never written to disk or stored (design §3.5): an adapter reads these
 * bytes in memory and keeps nothing of them but the snapshot it returns.
 */
export interface SourceFile {
  readonly bytes: Uint8Array;
}

/**
 * One adapter per app (design §3.1). `detect` answers whether the file is this app's format; `read` turns it into a
 * neutral `SourceSnapshot` with no database access. Unreadable input is a `Result` error with a stable PascalCase code;
 * a single unreadable row is a row error inside the snapshot, never a failed read.
 */
export interface SourceAdapter {
  readonly sourceApp: string;
  detect(file: SourceFile): boolean;
  read(file: SourceFile): Result<SourceSnapshot>;
}
