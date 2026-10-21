import { notFound } from "next/navigation";
import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { BalancesDto, MemberDto, SuggestionDto } from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { BalancesScreen } from "./balances-screen";

/** HU-E9-07: the members, every net balance and the settle-up suggestions of a space, read together. */
export const loadBalances = async (
  api: Api,
  input: { spaceId: string },
): Promise<
  Loaded<{ members: MemberDto[]; balances: BalancesDto["members"]; suggestions: SuggestionDto[] }>
> => {
  const path = { params: { path: { spaceId: input.spaceId } } };
  const [members, balances, suggestions] = await Promise.all([
    loaded(api.GET("/api/v1/spaces/{spaceId}/members", path)),
    loaded(api.GET("/api/v1/spaces/{spaceId}/balances", path)),
    loaded(api.GET("/api/v1/spaces/{spaceId}/balances/suggestions", path)),
  ]);
  if (!members.ok) return members;
  if (!balances.ok) return balances;
  if (!suggestions.ok) return suggestions;
  return {
    ok: true,
    data: {
      members: members.data.items,
      balances: balances.data.members,
      suggestions: suggestions.data.suggestions,
    },
  };
};

/** Server: the balances screen of a shared or direct space; a personal space has none, as it has no Saldos tab. */
export async function BalancesContainer({ spaceId }: { readonly spaceId: string }) {
  const [me, spaces] = await Promise.all([getMe(), getSpaces()]);
  const space = spaces.find((s) => s.id === spaceId);
  if (!space || space.kind === "PERSONAL") notFound();
  const result = await loadBalances(await serverApi(), { spaceId });
  if (!result.ok) return <ProblemNotice problem={result.problem} />;
  return (
    <BalancesScreen
      space={space}
      members={result.data.members}
      meUserId={me!.id}
      balances={result.data.balances}
      suggestions={result.data.suggestions}
      formats={me!.preferences.effective}
    />
  );
}
