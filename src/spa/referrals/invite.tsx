import { useQuery } from "@tanstack/react-query";
import { InviteRow } from "@/modules/referrals/ui";
import { useApis } from "../api";
import { useViewer } from "../viewer";
import { myReferralsQuery } from "./queries";

/**
 * D27: the personal Más invites someone to Hearth, with the points so far. The points never hold the screen: the row
 * opens Invitar a Hearth before they arrive, and a failed read only leaves them out.
 */
export function Invite({ spaceId }: { readonly spaceId: string }) {
  const { api } = useApis();
  const { me } = useViewer(spaceId);
  const points = useQuery({ ...myReferralsQuery(api), select: (mine) => mine.points }).data;
  return <InviteRow href={`/spaces/${spaceId}/invite`} points={points} formats={me.preferences.effective} />;
}
