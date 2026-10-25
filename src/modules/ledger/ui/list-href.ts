export interface ListFilter {
  readonly period?: string;
  readonly categoryId?: string;
  /** Issue #148: only what this member paid, in a shared space. */
  readonly payerMemberId?: string;
}

/** The transaction list of a space for a filter. A plain module: the server list and the client filters share it. */
export const hrefOf = (spaceId: string, filter: ListFilter) => {
  const query = new URLSearchParams();
  if (filter.period) query.set("period", filter.period);
  if (filter.categoryId) query.set("category", filter.categoryId);
  if (filter.payerMemberId) query.set("payer", filter.payerMemberId);
  const text = query.toString();
  return `/spaces/${spaceId}/transactions${text ? `?${text}` : ""}`;
};
