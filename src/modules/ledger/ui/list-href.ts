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

/** The transaction list of a space for a filter. A plain module: the server list and the client filters share it. */
export const hrefOf = (spaceId: string, filter: ListFilter) => {
  const query = new URLSearchParams();
  if (filter.period) query.set("period", filter.period);
  if (filter.categoryId) query.set("category", filter.categoryId);
  if (filter.payerMemberId) query.set("payer", filter.payerMemberId);
  if (filter.accountId) query.set("acct", filter.accountId);
  if (filter.type) query.set("type", filter.type);
  if (filter.search) query.set("q", filter.search);
  const text = query.toString();
  return `/spaces/${spaceId}/transactions${text ? `?${text}` : ""}`;
};

/** The API's query for a filter: what the list's first page and "Cargar más" both ask. */
export const listQueryOf = (filter: ListFilter) => ({
  period: filter.period,
  categoryIds: filter.categoryId,
  payerMemberId: filter.payerMemberId,
  accountId: filter.accountId,
  type: filter.type,
  search: filter.search,
});
