import { getTranslations } from "next-intl/server";
import { LineDashboardContainer } from "@/modules/reporting/ui/server";
import { routeScreen } from "@/shared/ui/api/route-screen";

export async function generateMetadata() {
  return { title: (await getTranslations("reports.view"))("lines") };
}

/** HU-E9-11: the Lines view of a space's Plan tab, the personal space's second view, `?period=<label>` (ruling P200). */
export default routeScreen<{ spaceId: string }, { period?: string }>(({ spaceId }, { period }) =>
  LineDashboardContainer({ spaceId, period }),
);
