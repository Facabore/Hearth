import { getTranslations } from "next-intl/server";
import { FundTrackingContainer } from "@/modules/reporting/ui/server";
import { routeScreen } from "@/shared/ui/api/route-screen";

export async function generateMetadata() {
  return { title: (await getTranslations("reports.view"))("fund") };
}

/** HU-E9-10: the Fund view of a shared space's Plan tab, `?period=<label>` (ruling P200). */
export default routeScreen<{ spaceId: string }, { period?: string }>(({ spaceId }, { period }) =>
  FundTrackingContainer({ spaceId, period }),
);
