// Client-safe: the detail sheet and the single-page app (ADR 0006) read this type; the loader reads the server API.
import type { MemberDto, TransactionDto } from "@/shared/ui/api/dto";
import type { Problem } from "@/shared/ui/api/problem";
import type { paths } from "@/shared/ui/api/schema";
import type { Viewer } from "./transaction-actions";

/** P344 (S7): one entry of a movement's audit, with the actor's name in the space when they are still a member. */
export type AuditEntryDto =
  paths["/api/v1/spaces/{spaceId}/transactions/{transactionId}/audit"]["get"]["responses"][200]["content"]["application/json"]["items"][number];

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
  /** P344 (S7): the movement's audit once read; while it is not (or its read failed) the sheet shows no history. */
  readonly history?: readonly AuditEntryDto[] | undefined;
}
