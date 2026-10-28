// Client-safe: the detail sheet and the single-page app (ADR 0006) read this type; the loader reads the server API.
import type { MemberDto, TransactionDto } from "@/shared/ui/api/dto";
import type { Problem } from "@/shared/ui/api/problem";
import type { Viewer } from "./transaction-actions";

export interface TransactionDetail {
  readonly tx: TransactionDto | null;
  readonly problem: Problem | null;
  readonly members: MemberDto[];
  readonly viewer: Viewer;
  /**
   * Issue #165: account id to name of the viewer's own accounts, read from their personal space (archived ones too),
   * so a shared row paid from one of them names it. Empty in a personal space, whose list already names its accounts.
   */
  readonly ownAccountNames: Record<string, string>;
}
