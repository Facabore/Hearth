import { getSpaces } from "@/shared/ui/api/server";
import { spaceOf } from "../report-period";
import { LineTrendContainer } from "./line-trend-container";
import { PersonalTrendContainer } from "./personal-trend-container";

/**
 * Ruling P200: the Trend view is the caller's own consumption in the personal space, and the trend of every line of
 * the end period's plan in a shared space.
 */
export async function TrendHomeContainer({
  spaceId,
  period,
  periods = 6,
}: {
  readonly spaceId: string;
  readonly period?: string;
  readonly periods?: 6 | 12;
}) {
  const space = spaceOf(await getSpaces(), spaceId);
  // Issue #196: called, not rendered as an element, so its reads and checks run inside the route's screen.
  return space.kind === "PERSONAL"
    ? PersonalTrendContainer({ spaceId, period, periods })
    : LineTrendContainer({ spaceId, period, periods });
}
