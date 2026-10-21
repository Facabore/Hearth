import { ProblemNotice } from "@/shared/ui";
import { getMe, getSpaces, loaded, serverApi } from "@/shared/ui/api/server";
import { HomeSummary } from "./home-summary";

/** Server: the current period's three latest rows and totals, the active accounts, and the names rows need. */
export async function HomeContainer({ spaceId }: { readonly spaceId: string }) {
  const api = await serverApi();
  const path = { spaceId };
  const [me, spaces, page, accounts, categories] = await Promise.all([
    getMe(),
    getSpaces(),
    loaded(api.GET("/api/v1/spaces/{spaceId}/transactions", { params: { path, query: { limit: 3 } } })),
    loaded(api.GET("/api/v1/spaces/{spaceId}/accounts", { params: { path } })),
    loaded(api.GET("/api/v1/spaces/{spaceId}/categories", { params: { path, query: { archived: "true" } } })),
  ]);
  const space = spaces.find((s) => s.id === spaceId);
  for (const result of [page, accounts, categories])
    if (!result.ok) return <ProblemNotice problem={result.problem} />;
  if (!space || !page.ok || !accounts.ok || !categories.ok) return null;
  const context = {
    formats: me!.preferences.effective,
    viewerZone: me!.timezone,
    groups: categories.data.items,
    accountNames: Object.fromEntries(accounts.data.items.map((a) => [a.id, a.name])),
  };
  return (
    <HomeSummary
      spaceId={spaceId}
      policy={space.periodPolicy}
      page={page.data}
      accounts={accounts.data.items}
      context={context}
    />
  );
}
