import { getTranslations } from "next-intl/server";
import { PlannerContainer } from "@/modules/budgeting/ui/server";
import { routeScreen } from "@/shared/ui/api/route-screen";

export async function generateMetadata() {
  return { title: (await getTranslations("budgeting.planner"))("metaTitle") };
}

/** HU-E9-08: the planner of one plan, reached from the Plan tab (ruling P200). */
export default routeScreen<{ spaceId: string; planId: string }>(({ spaceId, planId }) =>
  PlannerContainer({ spaceId, planId }),
);
