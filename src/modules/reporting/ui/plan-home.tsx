import { getSpaces } from "@/shared/ui/api/server";
import { LineDashboardContainer } from "./lines/lines-container";
import { spaceOf } from "./report-period";
import { UnifiedViewContainer } from "./unified/unified-container";

/** Ruling P200: the Plan tab's own page is My spending in the personal space and Lines in a shared one. */
export async function PlanHomeContainer({
  spaceId,
  period,
}: {
  readonly spaceId: string;
  readonly period?: string;
}) {
  const space = spaceOf(await getSpaces(), spaceId);
  return space.kind === "PERSONAL" ? (
    <UnifiedViewContainer spaceId={spaceId} period={period} />
  ) : (
    <LineDashboardContainer spaceId={spaceId} period={period} />
  );
}
