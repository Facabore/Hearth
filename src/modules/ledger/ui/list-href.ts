import type { ListFilter } from "./list-filter";
export type { ListFilter, ListSpace, TransactionKind } from "./list-filter";

// Ruling P310: the list's address lives beside the detail sheet's, which Inicio already loads.
export { hrefOf } from "./detail/tx-href";

/** The API's query for a filter: what the list's first page and "Cargar más" both ask. */
export const listQueryOf = (filter: ListFilter) => ({
  period: filter.period,
  categoryIds: filter.categoryId,
  payerMemberId: filter.payerMemberId,
  accountId: filter.accountId,
  type: filter.type,
  search: filter.search,
});

/** Ruling P319: the personal endpoint's query for a filter, across every space or the one chosen; it has no payer. */
export const myListQueryOf = (filter: ListFilter) => ({
  period: filter.period,
  spaceId: filter.spaceId,
  categoryIds: filter.categoryId,
  accountId: filter.accountId,
  type: filter.type,
  search: filter.search,
});
