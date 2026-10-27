import { ProblemNotice } from "@/shared/ui";
import { getMe, getSpaces, loaded, serverApi } from "@/shared/ui/api/server";
import { loadTransactionDetail } from "../detail/detail-loader";
import { HomeSummary } from "./home-summary";

/** Server: the current period's three latest rows and totals, the active accounts, and the names rows need. */
export async function HomeContainer({
  spaceId,
  joined = false,
  transactionId,
}: {
  readonly spaceId: string;
  /** `?joined=1`: the person has just accepted an invitation to this space (U6). */
  readonly joined?: boolean;
  /** `?tx=<id>`: the transaction whose detail sheet is open (ruling P189). */
  readonly transactionId?: string;
}) {
  const api = await serverApi();
  const path = { spaceId };
  const viewer = Promise.all([getMe(), getSpaces()]);
  // Issue #196: the detail behind `?tx=` needs only the person and their spaces, so it starts as soon as they answer,
  // beside the rows, the accounts and the categories.
  const detailRead = viewer.then(([me, spaces]) => {
    const space = spaces.find((s) => s.id === spaceId);
    return transactionId && space
      ? loadTransactionDetail(api, {
          spaceId,
          transactionId,
          space,
          meUserId: me!.id,
          personalSpaceId: spaces.find((s) => s.kind === "PERSONAL")?.id,
        })
      : undefined;
  });
  // A failed read below returns first and leaves the detail unawaited: never an unhandled rejection.
  void detailRead.catch(() => undefined);
  const [[me, spaces], page, accounts, categories] = await Promise.all([
    viewer,
    loaded(api.GET("/api/v1/spaces/{spaceId}/transactions", { params: { path, query: { limit: 3 } } })),
    loaded(api.GET("/api/v1/spaces/{spaceId}/accounts", { params: { path } })),
    loaded(api.GET("/api/v1/spaces/{spaceId}/categories", { params: { path, query: { archived: "true" } } })),
  ]);
  const space = spaces.find((s) => s.id === spaceId);
  for (const result of [page, accounts, categories])
    if (!result.ok) return <ProblemNotice problem={result.problem} />;
  if (!space || !page.ok || !accounts.ok || !categories.ok) return null;
  const detail = await detailRead;
  const context = {
    formats: me!.preferences.effective,
    viewerZone: me!.timezone,
    groups: categories.data.items,
    accountNames: Object.fromEntries(accounts.data.items.map((a) => [a.id, a.name])),
    memberNames: {},
  };
  return (
    <HomeSummary
      spaceId={spaceId}
      kind={space.kind}
      role={space.role}
      joined={joined ? { space: space.name, dismissHref: `/spaces/${spaceId}` } : undefined}
      policy={space.periodPolicy}
      page={page.data}
      accounts={accounts.data.items}
      context={context}
      {...(detail ? { detail } : {})}
    />
  );
}
