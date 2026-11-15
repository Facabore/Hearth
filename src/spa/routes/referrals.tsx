import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { ReferralsScreen } from "@/modules/referrals/ui/screens";
import { useApis } from "../api";
import { myReferralsQuery } from "../referrals/queries";
import { useTitle } from "../title";
import { useViewer } from "../viewer";

const route = getRouteApi("/spaces/$spaceId/invite");

/** D27: Invitar a Hearth, from the personal Más, which is its way back. */
export function ReferralsRoute() {
  useTitle(useTranslations("referrals")("title"));
  const { spaceId } = route.useParams();
  const { api } = useApis();
  const { me } = useViewer(spaceId);
  const referrals = useSuspenseQuery(myReferralsQuery(api)).data;
  return (
    <ReferralsScreen
      backHref={`/spaces/${spaceId}/more`}
      referrals={referrals}
      formats={me.preferences.effective}
    />
  );
}
