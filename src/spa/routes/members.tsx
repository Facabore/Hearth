import { useQuery, useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { BalanceHistory } from "@/modules/balances/ui/screens";
import { controlsFor } from "@/modules/spaces/ui";
import { MembersScreen } from "@/modules/spaces/ui/screens";
import { addDays, type LocalDate } from "@/shared/kernel/local-date";
import { NotFoundScreen } from "@/shared/ui";
import { useApis } from "../api";
import { balanceHistoryQuery, invitationsQuery, membersQuery, netBalancesQuery, periodQuery } from "../reads";
import { useTitle } from "../title";
import { useViewer } from "../viewer";

const members = getRouteApi("/spaces/$spaceId/members");
const history = getRouteApi("/spaces/$spaceId/members/$memberId/history");

/** HU-E9-05: the members of a shared or direct space, with the controls the viewer's role allows; `?invite=1` (N10). */
export function MembersRoute() {
  useTitle(useTranslations("members")("title"));
  const { spaceId } = members.useParams();
  const { invite } = members.useSearch();
  const { api } = useApis();
  const { me, space } = useViewer(spaceId);
  const canInvite = controlsFor(space.role, space.kind).invite;
  const [list, net] = useSuspenseQueries({
    queries: [membersQuery(api, spaceId), netBalancesQuery(api, spaceId)],
  });
  // Only someone who may invite reads the invitations (P155); everyone else gets none to show.
  const invitations = useQuery({ ...invitationsQuery(api, spaceId), enabled: canInvite });
  return (
    <div className="mx-auto max-w-[720px] py-3">
      <MembersScreen
        space={space}
        members={list.data}
        meUserId={me.id}
        invitations={canInvite ? (invitations.data ?? []) : null}
        balances={Object.fromEntries(net.data.members.map((m) => [m.memberId, m.net]))}
        openInvite={invite === "1"}
        formats={me.preferences.effective}
        viewerZone={me.timezone}
      />
    </div>
  );
}

/** HU-E9-07, ruling P176: a member's running balance over a period of the space, `?from=<date>` for another period. */
export function HistoryRoute() {
  useTitle(useTranslations("balances.history")("pageTitle"));
  const { spaceId, memberId } = history.useParams();
  const { from } = history.useSearch();
  const { api } = useApis();
  const { me, space } = useViewer(spaceId);
  const period = useSuspenseQuery(periodQuery(api, spaceId, from)).data;
  const list = useSuspenseQuery(membersQuery(api, spaceId)).data;
  if (!period) throw new Error("The API answered no period");
  const movements = useSuspenseQuery(balanceHistoryQuery(api, spaceId, memberId, period)).data;
  const previous = useQuery(periodQuery(api, spaceId, addDays(period.startDate as LocalDate, -1))).data;
  const next = useQuery(periodQuery(api, spaceId, addDays(period.endDate as LocalDate, 1))).data;
  const member = list.find((one) => one.id === memberId);
  // Not a current member of the space (removed, or another space's): not found, as the Next.js container answers.
  if (!member) return <NotFoundScreen />;
  return (
    <div className="mx-auto max-w-[720px] py-3">
      <BalanceHistory
        spaceId={space.id}
        spaceName={space.name}
        member={member}
        period={period}
        previous={previous ?? null}
        next={next ?? null}
        history={movements}
        formats={me.preferences.effective}
      />
    </div>
  );
}
