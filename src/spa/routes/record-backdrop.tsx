import { useQueryClient } from "@tanstack/react-query";
import { HomeSummary, TransactionList } from "@/modules/ledger/ui";
import { addDays, type LocalDate } from "@/shared/kernel/local-date";
import { safeReturnTo } from "@/shared/ui/navigation/auth-redirect";
import { nowIn } from "@/shared/ui/time/when";
import { useApis } from "../api";
import { memberNamesOf, movedOf, rowContextOf } from "../ledger/hooks";
import { recentPeriodsQuery } from "../ledger/list-hooks";
import { listFilterOf } from "../ledger/list-search";
import { homeRowsOf, listQueryOf, pageQuery } from "../ledger/queries";
import { sharedSpace, type Viewer } from "../load";
import { accountListQuery, categoriesQuery, membersQuery, netBalancesQuery, periodQuery } from "../reads";
import { pendingOccurrencesQuery } from "../recurring-pending/queries";
// Inicio's and Movimientos' own route modules, so their components stay in those routes' chunks: the backdrop loads the
// chunks its origin screen already loaded, and neither route's script is split anew (ADR 0004).
import "./space-home";
import "./transactions";

/**
 * Ruling P300 (#240, board B1 · 01): the screen the record sheet was opened from, inside the inert frame under its scrim
 * (`ledger/record-behind.tsx`). It is Movimientos when `returnTo` is the space's list, and the space's Inicio for any
 * other origin or none. It draws only what the query cache already holds and never reads: a screen that is not there
 * leaves the frame empty.
 */
export function RecordBackdrop({
  viewer,
  returnTo,
}: {
  readonly viewer: Viewer;
  readonly returnTo: string | undefined;
}) {
  const list = listSearchOf(viewer.space.id, returnTo);
  return list ? <ListBehind viewer={viewer} search={list} /> : <HomeBehind viewer={viewer} />;
}

/** Movimientos' address search when `returnTo` is this space's list, or nothing for any other origin. */
const listSearchOf = (spaceId: string, returnTo: string | undefined): Record<string, string> | null => {
  const origin = safeReturnTo(returnTo);
  if (origin === null) return null;
  const url = new URL(origin, "http://origin.invalid");
  return url.pathname === `/spaces/${spaceId}/transactions` ? Object.fromEntries(url.searchParams) : null;
};

/** Inicio as its loader left it in the cache: its latest rows, active accounts and every category. */
function HomeBehind({ viewer }: { readonly viewer: Viewer }) {
  const { api } = useApis();
  const cache = useQueryClient();
  const { me, space } = viewer;
  const page = cache.getQueryData(pageQuery(api, space.id, { limit: homeRowsOf(viewer) }).queryKey);
  const accounts = cache.getQueryData(accountListQuery(api, space.id, "active").queryKey)?.items;
  const groups = cache.getQueryData(categoriesQuery(api, space.id, "all").queryKey);
  if (!page || !accounts || !groups) return null;
  return (
    <HomeSummary
      spaceId={space.id}
      kind={space.kind}
      role={space.role}
      policy={space.periodPolicy}
      page={page}
      accounts={accounts}
      // P307: a shared space's rows name its members when the cache holds them; the backdrop never waits for them.
      context={rowContextOf(
        me,
        groups,
        accounts,
        sharedSpace(space)
          ? memberNamesOf(cache.getQueryData(membersQuery(api, space.id).queryKey) ?? [])
          : {},
      )}
      today={nowIn(new Date(), me.timezone).date}
      // The person's eye: amounts she hid on Inicio stay hidden behind the sheet.
      personId={me.id}
    />
  );
}

/** Movimientos under the address's filter as its loader left it in the cache; its optional reads only when held. */
function ListBehind({
  viewer,
  search,
}: {
  readonly viewer: Viewer;
  readonly search: Record<string, string>;
}) {
  const { api } = useApis();
  const cache = useQueryClient();
  const { me, space } = viewer;
  const filter = listFilterOf(search);
  const today = nowIn(new Date(), me.timezone).date;
  const page = cache.getQueryData(pageQuery(api, space.id, listQueryOf(filter)).queryKey);
  const accounts = cache.getQueryData(accountListQuery(api, space.id, "all").queryKey)?.items;
  const groups = cache.getQueryData(categoriesQuery(api, space.id, "all").queryKey);
  const members = sharedSpace(space) ? cache.getQueryData(membersQuery(api, space.id).queryKey) : [];
  if (!page || !accounts || !groups || !members) return null;
  const { startDate, endDate } = page.period;
  const period = (date: string) => cache.getQueryData(periodQuery(api, space.id, date).queryKey) ?? null;
  const balances = sharedSpace(space)
    ? cache.getQueryData(netBalancesQuery(api, space.id).queryKey)
    : undefined;
  const pending = cache.getQueryData(pendingOccurrencesQuery(api, space.id).queryKey) ?? [];
  return (
    <TransactionList
      spaceId={space.id}
      page={page}
      context={rowContextOf(
        me,
        groups,
        accounts,
        Object.fromEntries(members.map((m) => [m.id, m.displayName])),
      )}
      today={today}
      filter={filter}
      {...(space.kind !== "PERSONAL" ? { spaceName: space.name } : {})}
      periodPolicy={space.periodPolicy}
      previous={period(addDays(startDate as LocalDate, -1))}
      next={period(addDays(endDate as LocalDate, 1))}
      periods={cache.getQueryData(recentPeriodsQuery(api, space.id, today).queryKey)}
      accounts={accounts}
      movedMemberIds={movedOf(balances?.members)}
      pendingCount={pending.length}
      pendingNames={pending.map((occurrence) => occurrence.description)}
    />
  );
}
