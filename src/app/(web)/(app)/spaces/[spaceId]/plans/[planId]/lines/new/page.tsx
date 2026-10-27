import { getTranslations } from "next-intl/server";
import { LineEditorContainer } from "@/modules/budgeting/ui/server";
import { routeScreen } from "@/shared/ui/api/route-screen";

export async function generateMetadata() {
  return { title: (await getTranslations("budgeting.lineEditor"))("newTitle") };
}

/** HU-E9-08: a new line of one plan, reached from the planner. */
export default routeScreen<{ spaceId: string; planId: string }>(({ spaceId, planId }) =>
  LineEditorContainer({ spaceId, planId, lineId: null }),
);
