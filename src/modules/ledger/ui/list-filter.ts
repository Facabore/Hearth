/** HU-E9-03: what Movimientos is narrowed to; its address (`hrefOf`) and the API's query (`listQueryOf`) follow it. */
export type TransactionKind = "EXPENSE" | "INCOME" | "TRANSFER" | "SETTLEMENT";

export interface ListFilter {
  readonly period?: string;
  readonly categoryId?: string;
  /** Issue #148: only what this member paid, in a shared space. */
  readonly payerMemberId?: string;
  /** Ruling P277: only what this account paid, received or moved (`?acct=`: `?account=` names a saved notice's fund). */
  readonly accountId?: string;
  /** Ruling P277: only this kind of movement. */
  readonly type?: TransactionKind;
  /** Ruling P277: a piece of the description (`?q=`). */
  readonly search?: string;
}
