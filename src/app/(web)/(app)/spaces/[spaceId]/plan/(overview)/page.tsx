import { getTranslations } from "next-intl/server";
import { PlanHomeContainer } from "@/modules/reporting/ui/server";
import { routeScreen } from "@/shared/ui/api/route-screen";

export async function generateMetadata() {
  return { title: (await getTranslations("reports"))("title") };
}

/** HU-E9-10, HU-E9-11: the Plan tab of a space, `?period=<label>`; My spending in the personal space (ruling P200). */
export default routeScreen<{ spaceId: string }, { period?: string }>(({ spaceId }, { period }) =>
  PlanHomeContainer({ spaceId, period }),
);
