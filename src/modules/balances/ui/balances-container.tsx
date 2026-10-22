import { notFound } from "next/navigation";
import { sharedContextOf } from "@/modules/ledger/ui";
import { controlsFor, personalSpaceOf } from "@/modules/spaces/ui";
import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { AccountDto, BalancesDto, MemberDto, SuggestionDto } from "@/shared/ui/api/dto";
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

/**
 * HU-E9-07, ruling P174: the accounts a payment of the viewer's may leave from or arrive in: those of their personal
 * space, then their own in this space (D9), derived by the shared expense's `sharedContextOf`. They are optional, so
 * accounts that cannot be read leave the choice out instead of failing the balances, as the personal expense's people.
 */
export const loadMyAccounts = async (
  api: Api,
  input: {
    spaceId: string;
    personalSpaceId: string;
    meUserId: string;
    members: readonly MemberDto[];
  },
): Promise<AccountDto[]> => {
  const [space, personal] = await Promise.all(
    [input.spaceId, input.personalSpaceId].map((spaceId) =>
      loaded(api.GET("/api/v1/spaces/{spaceId}/accounts", { params: { path: { spaceId } } })),
    ),
  );
  if (!space?.ok || !personal?.ok) return [];
  return [
    ...(sharedContextOf({
      meUserId: input.meUserId,
      members: input.members,
      spaceAccounts: space.data.items,
      personalAccounts: personal.data.items,
    })?.myAccounts ?? []),
  ];
};

/** Server: the balances screen of a shared or direct space; a personal space has none, as it has no Saldos tab. */
export async function BalancesContainer({
  spaceId,
  settle,
}: {
  readonly spaceId: string;
  /** A member id from `?settle=`: the settle-up sheet opens for that member. */
  readonly settle?: string | undefined;
}) {
  const [me, spaces] = await Promise.all([getMe(), getSpaces()]);
  const space = spaces.find((s) => s.id === spaceId);
  if (!space || space.kind === "PERSONAL") notFound();
  const api = await serverApi();
  const result = await loadBalances(api, { spaceId });
  if (!result.ok) return <ProblemNotice problem={result.problem} />;
  // Only somebody who records money is offered the accounts; a viewer reads the balances alone.
  const myAccounts = controlsFor(space.role, space.kind).recordMoney
    ? await loadMyAccounts(api, {
        spaceId,
        personalSpaceId: personalSpaceOf(spaces).id,
        meUserId: me!.id,
        members: result.data.members,
      })
    : [];
  return (
    <BalancesScreen
      space={space}
      members={result.data.members}
      meUserId={me!.id}
      balances={result.data.balances}
      suggestions={result.data.suggestions}
      formats={me!.preferences.effective}
      myAccounts={myAccounts}
      settle={settle}
      timeZone={me!.timezone}
    />
  );
}
