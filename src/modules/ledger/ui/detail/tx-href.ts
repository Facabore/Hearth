import type { ListFilter } from "../list-filter";

/** Ruling P189: the detail sheet is addressed by `?tx=<id>` on the page that lists the row. */
export const withTx = (href: string, id: string): string => {
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  params.set("tx", id);
  return `${path}?${params.toString()}`;
};

/** The same address without the sheet: what closing it replaces the entry with. */
export const withoutTx = (href: string): string => {
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  params.delete("tx");
  const text = params.toString();
  return text ? `${path}?${text}` : path!;
};

/**
 * The transaction list of a space for a filter. A plain module: the server list, the client filters and Inicio's links
 * (ruling P310) share it.
 */
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
