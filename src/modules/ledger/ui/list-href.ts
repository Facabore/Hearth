export interface ListFilter {
  readonly period?: string;
  readonly categoryId?: string;
}

/** The transaction list of a space for a filter. A plain module: the server list and the client filters share it. */
export const hrefOf = (spaceId: string, filter: ListFilter) => {
  const query = new URLSearchParams();
  if (filter.period) query.set("period", filter.period);
  if (filter.categoryId) query.set("category", filter.categoryId);
  const text = query.toString();
  return `/spaces/${spaceId}/transactions${text ? `?${text}` : ""}`;
};
