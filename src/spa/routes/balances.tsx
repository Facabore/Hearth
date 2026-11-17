import { useQuery, useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { BalancesScreen } from "@/modules/balances/ui";
import { FriendsScreen } from "@/modules/balances/ui/screens";
import { sharedContextOf } from "@/modules/ledger/ui";
import { controlsFor, personalSpaceOf } from "@/modules/spaces/ui";
import { nowIn } from "@/shared/ui/time/when";
import { useApis } from "../api";
import { accountsQuery, membersQuery, netBalancesQuery, suggestionsQuery } from "../reads";
import { myFriendsQuery } from "../shell";
import { useTitle } from "../title";
import { useViewer } from "../viewer";

const route = getRouteApi("/spaces/$spaceId/balances");

/**
 * HU-E9-07: who owes whom in a shared or direct space, the settle-up suggestions and the settle-up sheet. `?settle=` is
 * a member id (the guest sheet's "Saldar"): the sheet opens with that member paying. Ruling P338: in the personal space
 * the tab is Amigos.
 */
export function BalancesRoute() {
  const { spaceId } = route.useParams();
  const { space } = useViewer(spaceId);
  return space.kind === "PERSONAL" ? <FriendsRoute spaceId={spaceId} /> : <SpaceBalances spaceId={spaceId} />;
}

/** Ruling P338 (board "Amigos · cada persona con su saldo"): the people the person shares a direct space with. */
function FriendsRoute({ spaceId }: { readonly spaceId: string }) {
  useTitle(useTranslations("friends")("title"));
  const { api } = useApis();
  const { me } = useViewer(spaceId);
  const friends = useSuspenseQuery(myFriendsQuery(api)).data;
  return (
    <div className="mx-auto max-w-[720px] py-3">
      <FriendsScreen
        spaceId={spaceId}
        friends={friends}
        formats={me.preferences.effective}
        today={nowIn(new Date(), me.timezone).date}
      />
    </div>
  );
}

function SpaceBalances({ spaceId }: { readonly spaceId: string }) {
  useTitle(useTranslations("balances")("title"));
  const { settle } = route.useSearch();
  const { api } = useApis();
  const { me, space, spaces } = useViewer(spaceId);
  const [list, net, suggestions] = useSuspenseQueries({
    queries: [membersQuery(api, spaceId), netBalancesQuery(api, spaceId), suggestionsQuery(api, spaceId)],
  });
  // P174: the accounts a payment of the viewer's may leave from or arrive in, only for someone who records money.
  // They are optional: accounts that cannot be read leave the choice out instead of failing the balances.
  const recordsMoney = controlsFor(space.role, space.kind).recordMoney;
  const own = useQuery({ ...accountsQuery(api, spaceId, "active"), enabled: recordsMoney });
  const personal = useQuery({
    ...accountsQuery(api, personalSpaceOf(spaces).id, "active"),
    enabled: recordsMoney,
  });
  const myAccounts =
    recordsMoney && own.data && personal.data
      ? (sharedContextOf({
          meUserId: me.id,
          members: list.data,
          spaceAccounts: own.data,
          personalAccounts: personal.data,
        })?.myAccounts ?? [])
      : [];
  return (
    <div className="mx-auto max-w-[720px] py-3">
      <BalancesScreen
        space={space}
        members={list.data}
        meUserId={me.id}
        balances={net.data.members}
        suggestions={suggestions.data}
        formats={me.preferences.effective}
        myAccounts={[...myAccounts]}
        settle={settle}
        timeZone={me.timezone}
      />
    </div>
  );
}
