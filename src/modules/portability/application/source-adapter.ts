import type { Result } from "@/shared/kernel";
import type { SourceSnapshot } from "../domain/source-snapshot";

/** A file handed to an adapter. The raw bytes are never stored (design §3.5); the adapter reads them read-only. */
export interface SourceFile {
  readonly path: string;
}

/**
 * One adapter per app (design §3.1). `detect` answers whether the file is this app's format; `read` turns it into a
 * neutral `SourceSnapshot` with no database access. Unreadable input is a `Result` error with a stable PascalCase code.
 */
export interface SourceAdapter {
  readonly sourceApp: string;
  detect(file: SourceFile): boolean;
  read(file: SourceFile): Result<SourceSnapshot>;
}
