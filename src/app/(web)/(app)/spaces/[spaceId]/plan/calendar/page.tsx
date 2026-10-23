import { getTranslations } from "next-intl/server";
import { CalendarContainer } from "@/modules/reporting/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("reports"))("calendar.metaTitle") };
}

/** #150: what comes in and goes out over the next 30 or 60 days, `?days=30|60` (ruling P241 of M6c). */
export default async function CalendarPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ spaceId: string }>;
  readonly searchParams: Promise<{ days?: string }>;
}) {
  const [{ spaceId }, { days }] = await Promise.all([params, searchParams]);
  return <CalendarContainer spaceId={spaceId} days={days} />;
}
