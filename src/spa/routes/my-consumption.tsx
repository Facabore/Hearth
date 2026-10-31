import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { MyConsumptionScreen } from "@/modules/reporting/ui/screens";
import { useApis } from "../api";
import { unifiedViewQuery } from "../reads";
import { useTitle } from "../title";
import { useViewer } from "../viewer";
import { useLabel, useNeighbours } from "../plan/period";

const myConsumption = getRouteApi("/spaces/$spaceId/my-consumption");

/**
 * Ruling P267 (U10, U4): Mi consumo, the person's month across every space, as a stacked screen of the personal space.
 * It is a chunk of its own, so the Plan views never download its screen (ADR 0006), and it reuses their period hooks.
 */
export function MyConsumptionRoute() {
  useTitle(useTranslations("reports.view")("mine"));
  const viewer = useViewer(myConsumption.useParams().spaceId);
  const { api } = useApis();
  const label = useLabel(viewer, myConsumption.useSearch().period);
  const view = useSuspenseQuery(unifiedViewQuery(api, viewer.space.id, label)).data;
  const { previous, next } = useNeighbours(viewer.space.id, view.period);
  return (
    <MyConsumptionScreen
      space={viewer.space}
      view={view}
      previous={previous}
      next={next}
      formats={viewer.me.preferences.effective}
    />
  );
}
