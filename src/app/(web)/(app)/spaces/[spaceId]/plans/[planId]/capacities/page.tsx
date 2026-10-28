import { getTranslations } from "next-intl/server";
import { CapacityContainer } from "@/modules/budgeting/ui/server";
import { routeScreen } from "@/shared/ui/api/route-screen";

export async function generateMetadata() {
  return { title: (await getTranslations("budgeting.capacity"))("title") };
}

/** HU-E9-08: the capacities of one plan, with the viewer's private suggestion, reached from the planner. */
export default routeScreen<{ spaceId: string; planId: string }>(({ spaceId, planId }) =>
  CapacityContainer({ spaceId, planId }),
);
