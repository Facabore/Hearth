import { getTranslations } from "next-intl/server";
import { GroupsHomeContainer } from "@/modules/reporting/ui/server";
import { routeScreen } from "@/shared/ui/api/route-screen";

export async function generateMetadata() {
  return { title: (await getTranslations("reports.view"))("groups") };
}

/** HU-E9-10, HU-E9-11: the By group view of the Plan tab, the caller's own in the personal space, `?period=<label>`, drilling with `?drill=` (P200, P215). */
export default routeScreen<{ spaceId: string }, { period?: string }>(({ spaceId }, { period }) =>
  GroupsHomeContainer({ spaceId, period }),
);
