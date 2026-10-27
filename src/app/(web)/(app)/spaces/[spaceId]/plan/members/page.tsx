import { getTranslations } from "next-intl/server";
import { MemberMatrixContainer } from "@/modules/reporting/ui/server";
import { routeScreen } from "@/shared/ui/api/route-screen";

export async function generateMetadata() {
  return { title: (await getTranslations("reports"))("view.members") };
}

/** HU-E9-10: the member matrix of the Plan tab, `?period=<label>` (ruling P200). */
export default routeScreen<{ spaceId: string }, { period?: string }>(({ spaceId }, { period }) =>
  MemberMatrixContainer({ spaceId, period }),
);
