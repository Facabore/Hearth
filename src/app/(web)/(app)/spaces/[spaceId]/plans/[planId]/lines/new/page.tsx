import { getTranslations } from "next-intl/server";
import { LineEditorContainer } from "@/modules/budgeting/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("budgeting.lineEditor"))("newTitle") };
}

/** HU-E9-08: a new line of one plan, reached from the planner. */
export default async function NewLinePage({
  params,
}: {
  readonly params: Promise<{ spaceId: string; planId: string }>;
}) {
  const { spaceId, planId } = await params;
  return <LineEditorContainer spaceId={spaceId} planId={planId} lineId={null} />;
}
