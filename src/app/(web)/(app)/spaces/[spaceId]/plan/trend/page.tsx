import { getTranslations } from "next-intl/server";
import { TrendHomeContainer, windowOf } from "@/modules/reporting/ui/server";
import { routeScreen } from "@/shared/ui/api/route-screen";

export async function generateMetadata() {
  return { title: (await getTranslations("reports.view"))("trend") };
}

/**
 * HU-E9-11: the Trend view of the Plan tab, the caller's own consumption in the personal space and every plan line's
 * trend in a shared space, `?period=<label>&periods=6|12` (P200, P219).
 */
export default routeScreen<{ spaceId: string }, { period?: string; periods?: string }>(
  ({ spaceId }, { period, periods }) => TrendHomeContainer({ spaceId, period, periods: windowOf(periods) }),
);
