import { getTranslations } from "next-intl/server";
import { LineEditorContainer } from "@/modules/budgeting/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("budgeting.lineEditor"))("metaTitle") };
}

/** HU-E9-08: one line of a plan, to edit or remove, reached from the planner. */
export default async function EditLinePage({
  params,
}: {
  readonly params: Promise<{ spaceId: string; planId: string; lineId: string }>;
}) {
  const { spaceId, planId, lineId } = await params;
  return <LineEditorContainer spaceId={spaceId} planId={planId} lineId={lineId} />;
}
