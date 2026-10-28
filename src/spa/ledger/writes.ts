import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { SpaceDto, TransactionDto, TransactionPageDto } from "@/shared/ui/api/dto";
import { moduleKeys, queryKeys } from "../queries";
import type { WritePlan, WritePlanner } from "../writes";
import { ledgerKeys, type PageQuery, type TransactionRead } from "./queries";

/**
 * The API's order of a page (P43): newest day first, then the newest time with untimed rows last, then the newest
 * recorded. A row the cache places itself sits where the next read will put it.
 */
const before = (a: TransactionDto, b: TransactionDto): boolean => {
  if (a.date !== b.date) return a.date > b.date;
  if (a.occurredAt !== b.occurredAt) {
    if (a.occurredAt === null || b.occurredAt === null) return b.occurredAt === null;
    return Date.parse(a.occurredAt) > Date.parse(b.occurredAt);
  }
  if (a.createdAt !== b.createdAt) return Date.parse(a.createdAt) > Date.parse(b.createdAt);
  return a.id > b.id;
};

/**
 * A row in a page, where the API would list it: only in its period, never under a category or payer filter (the API
 * decides those), never past a page that continues, and a page with a limit keeps its length.
 */
const withRow = (page: TransactionPageDto, query: PageQuery, tx: TransactionDto): TransactionPageDto => {
  const items = page.items.filter((item) => item.id !== tx.id);
  const filtered = query.categoryIds !== undefined || query.payerMemberId !== undefined;
  if (filtered || tx.date < page.period.startDate || tx.date > page.period.endDate) return { ...page, items };
  const at = items.findIndex((item) => before(tx, item));
  if (at === -1 && page.nextCursor !== null) return { ...page, items };
  const placed = at === -1 ? [...items, tx] : [...items.slice(0, at), tx, ...items.slice(at)];
  return { ...page, items: placed.length > query.limit ? placed.slice(0, query.limit) : placed };
};

const withoutRow = (page: TransactionPageDto, id: string): TransactionPageDto => ({
  ...page,
  items: page.items.filter((item) => item.id !== id),
});

/** A changed row keeps its place in a filtered page (the API decides whether it still belongs), else moves. */
const withChangedRow = (
  page: TransactionPageDto,
  query: PageQuery,
  tx: TransactionDto,
): TransactionPageDto =>
  query.categoryIds !== undefined || query.payerMemberId !== undefined
    ? { ...page, items: page.items.map((item) => (item.id === tx.id ? tx : item)) }
    : withRow(page, query, tx);

type Pages = [QueryKey, TransactionPageDto | undefined][];

const pagesOf = (queryClient: QueryClient, spaceId: string): Pages =>
  queryClient.getQueriesData<TransactionPageDto>({ queryKey: ledgerKeys.pages(spaceId) });

const queryOf = (key: QueryKey): PageQuery => key[3] as PageQuery;

const editPages = (
  queryClient: QueryClient,
  spaceId: string,
  edit: (page: TransactionPageDto, query: PageQuery) => TransactionPageDto,
): void => {
  for (const [key, page] of pagesOf(queryClient, spaceId))
    if (page) queryClient.setQueryData(key, edit(page, queryOf(key)));
};

/** Moves rows before the API answers, cancelling the reads that would overwrite them; the undo puts the pages back. */
const optimistically = async (
  queryClient: QueryClient,
  spaceId: string,
  edit: (page: TransactionPageDto, query: PageQuery) => TransactionPageDto,
): Promise<() => void> => {
  await queryClient.cancelQueries({ queryKey: ledgerKeys.pages(spaceId) });
  const snapshot = pagesOf(queryClient, spaceId);
  editPages(queryClient, spaceId, edit);
  return () => {
    for (const [key, page] of snapshot) queryClient.setQueryData(key, page);
  };
};

const detailOf = (tx: TransactionDto): TransactionRead => ({ tx, problem: null, missing: false });

/**
 * "Cambios respectivos para cada cosa" (ADR 0006): a movement changes its space's pages and totals, its accounts'
 * balances and the plan's reports (D7: all computed on read). In a shared or direct space it may be paid from the
 * person's own accounts, which live in their personal space. Nothing else is read again: not the categories, the
 * members, the periods, the person or their spaces.
 */
const invalidateMovement = (queryClient: QueryClient, spaceId: string): void => {
  const keys: QueryKey[] = [
    ledgerKeys.pages(spaceId),
    moduleKeys.accounts(spaceId),
    moduleKeys.reports(spaceId),
  ];
  const spaces = queryClient.getQueryData<SpaceDto[]>(queryKeys.spaces) ?? [];
  const personal = spaces.find((space) => space.kind === "PERSONAL");
  if (personal && personal.id !== spaceId) keys.push(moduleKeys.accounts(personal.id));
  for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
};

/** A transaction that no longer exists: its cached detail is stale, but no open sheet reads it again at once. */
const forget = (queryClient: QueryClient, spaceId: string, id: string): void =>
  void queryClient.invalidateQueries({ queryKey: ledgerKeys.transaction(spaceId, id), refetchType: "none" });

/** The API's answer for a movement: its detail and its row, as the next read would return them. */
const saved = (queryClient: QueryClient, spaceId: string, tx: TransactionDto): void => {
  queryClient.setQueryData(ledgerKeys.transaction(spaceId, tx.id), detailOf(tx));
  editPages(queryClient, spaceId, (page, query) => withChangedRow(page, query, tx));
  invalidateMovement(queryClient, spaceId);
};

const RECORD = /^\/api\/v1\/spaces\/\{spaceId\}\/(expenses|incomes|transfers)$/;
const ONE = "/api/v1/spaces/{spaceId}/transactions/{transactionId}";

/** Issue #195: what each conversion became, per app, so its undo can take that row away again. */
const conversionsOf = new WeakMap<QueryClient, Map<string, string>>();
const conversions = (queryClient: QueryClient): Map<string, string> => {
  const own = conversionsOf.get(queryClient) ?? new Map<string, string>();
  conversionsOf.set(queryClient, own);
  return own;
};

/** An expense's answer carries its warnings (P170) beside the transaction; the cache keeps the transaction. */
const movementOf = (data: unknown): TransactionDto => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { warnings, ...tx } = data as TransactionDto & { warnings?: unknown };
  return tx;
};

/**
 * The ledger's writes in the SPA: recording (P195), editing (P191), deleting and restoring (P194), converting and
 * undoing it (#195), and a split with one person (P172).
 */
export const ledgerWrites: WritePlanner = (call): WritePlan | null => {
  const { spaceId = "", transactionId = "" } = call.params;
  if (call.method === "POST" && RECORD.test(call.path))
    return { accepted: (queryClient, data) => saved(queryClient, spaceId, movementOf(data)) };
  if (call.method === "POST" && call.path === "/api/v1/direct-splits")
    return {
      accepted: (queryClient, data) => {
        const split = data as { spaceId: string; created: boolean; expense: unknown };
        // A first split with someone opens a direct space, which the space switcher lists.
        if (split.created) void queryClient.invalidateQueries({ queryKey: queryKeys.spaces });
        saved(queryClient, split.spaceId, movementOf(split.expense));
      },
    };
  if (call.method === "PATCH" && call.path === ONE)
    return { accepted: (queryClient, data) => saved(queryClient, spaceId, data as TransactionDto) };
  if (call.method === "DELETE" && call.path === ONE)
    return {
      // The sheet closes and the row leaves at once; a refusal puts it back (P194).
      optimistic: (queryClient) =>
        optimistically(queryClient, spaceId, (page) => withoutRow(page, transactionId)),
      accepted: (queryClient) => {
        forget(queryClient, spaceId, transactionId);
        invalidateMovement(queryClient, spaceId);
      },
    };
  if (call.method === "POST" && call.path === `${ONE}/restore`)
    return {
      // Deshacer brings the row back where it was before the API answers.
      optimistic: async (queryClient) => {
        const tx = queryClient.getQueryData<TransactionRead>(
          ledgerKeys.transaction(spaceId, transactionId),
        )?.tx;
        return optimistically(queryClient, spaceId, (page, query) => (tx ? withRow(page, query, tx) : page));
      },
      accepted: (queryClient, data) => saved(queryClient, spaceId, data as TransactionDto),
    };
  if (call.method === "POST" && call.path === `${ONE}/convert`)
    return {
      accepted: (queryClient, data) => {
        const became = data as TransactionDto;
        conversions(queryClient).set(transactionId, became.id);
        editPages(queryClient, spaceId, (page) => withoutRow(page, transactionId));
        forget(queryClient, spaceId, transactionId);
        saved(queryClient, spaceId, became);
      },
    };
  if (call.method === "POST" && call.path === `${ONE}/convert/undo`)
    return {
      accepted: (queryClient, data) => {
        const became = conversions(queryClient).get(transactionId);
        conversions(queryClient).delete(transactionId);
        if (became) {
          editPages(queryClient, spaceId, (page) => withoutRow(page, became));
          forget(queryClient, spaceId, became);
        }
        saved(queryClient, spaceId, data as TransactionDto);
      },
    };
  return null;
};
