import { useQuery, useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import type { FriendDto } from "@/modules/balances/ui";
import { sharedContextOf } from "@/modules/ledger/ui";
import { FriendScreen } from "@/modules/balances/ui/screens";
import { controlsFor } from "@/modules/spaces/ui";
import type { SpaceDto } from "@/shared/ui/api/dto";
import { nowIn } from "@/shared/ui/time/when";
import { useApis } from "../api";
import {
  accountsQuery,
  friendHistoryQuery,
  membersQuery,
  netBalancesQuery,
  otherCurrenciesOf,
  suggestionsQuery,
} from "../reads";
import { myFriendsQuery } from "../shell";
import { useTitle } from "../title";
import { useViewer } from "../viewer";

const route = getRouteApi("/spaces/$spaceId/friends/$friendSpaceId");

/**
 * Ruling P338 (board "Amigo · Mom"): one person of Amigos, stacked under the personal space with its way back to
 * Amigos. Their direct space's balances, suggestions and members feed Saldar's sheet; the history is every movement
 * between the two (the loader read it all, and answered not found for anyone else). Ruling P339: a person just removed
 * leaves Amigos and the spaces before the screen goes back to Amigos, so the screen draws nothing meanwhile.
 */
export function FriendRoute() {
  const { spaceId, friendSpaceId } = route.useParams();
  const { api } = useApis();
  const { spaces } = useViewer(spaceId);
  const friend = useSuspenseQuery(myFriendsQuery(api)).data.find((f) => f.spaceId === friendSpaceId);
  const space = spaces.find((s) => s.id === friendSpaceId);
  return friend && space ? <Friend spaceId={spaceId} friend={friend} space={space} /> : null;
}

function Friend({
  spaceId,
  friend,
  space,
}: {
  readonly spaceId: string;
  readonly friend: FriendDto;
  readonly space: SpaceDto;
}) {
  const friendSpaceId = space.id;
  const { api } = useApis();
  const { me } = useViewer(spaceId);
  useTitle(friend.name);
  const [list, net, suggestions, history] = useSuspenseQueries({
    queries: [
      membersQuery(api, friendSpaceId),
      netBalancesQuery(api, friendSpaceId),
      suggestionsQuery(api, friendSpaceId),
      friendHistoryQuery(api, friendSpaceId, friend.me.memberId),
    ],
  });
  // P342: the movements in each other currency the two owe each other in, which the loader read.
  const otherCurrencies = useSuspenseQueries({
    queries: otherCurrenciesOf(friend, space.currency).map((currency) =>
      friendHistoryQuery(api, friendSpaceId, friend.me.memberId, currency),
    ),
  }).map((one) => one.data);
  // P174: the accounts a payment of the viewer's may leave from or arrive in, as on Saldos; optional.
  const recordsMoney = controlsFor(space.role, space.kind).recordMoney;
  const own = useQuery({ ...accountsQuery(api, friendSpaceId, "active"), enabled: recordsMoney });
  const personal = useQuery({ ...accountsQuery(api, spaceId, "active"), enabled: recordsMoney });
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
      <FriendScreen
        personalSpaceId={spaceId}
        friend={friend}
        space={space}
        members={list.data}
        meUserId={me.id}
        balances={net.data.members}
        suggestions={suggestions.data}
        history={history.data}
        otherCurrencies={otherCurrencies}
        formats={me.preferences.effective}
        today={nowIn(new Date(), me.timezone).date}
        timeZone={me.timezone}
        myAccounts={[...myAccounts]}
      />
    </div>
  );
}
