import { notFound } from "next/navigation";
import { getSpaces } from "@/shared/ui/api/server";
import { spaceOf } from "../report-period";
import { PersonalTrendContainer } from "./personal-trend-container";

/** Ruling P200: the Trend view is the caller's own consumption in the personal space. Task 15 adds the line trend. */
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
  if (space.kind !== "PERSONAL") notFound();
  return <PersonalTrendContainer spaceId={spaceId} period={period} periods={periods} />;
}
