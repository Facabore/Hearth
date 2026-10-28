import { getTranslations } from "next-intl/server";
import { LineEditorContainer } from "@/modules/budgeting/ui/server";
import { routeScreen } from "@/shared/ui/api/route-screen";

export async function generateMetadata() {
  return { title: (await getTranslations("budgeting.lineEditor"))("metaTitle") };
}

/** HU-E9-08: one line of a plan, to edit or remove, reached from the planner. */
export default routeScreen<{ spaceId: string; planId: string; lineId: string }>(
  ({ spaceId, planId, lineId }) => LineEditorContainer({ spaceId, planId, lineId }),
);
