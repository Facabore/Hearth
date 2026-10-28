import { getTranslations } from "next-intl/server";
import { CalendarContainer } from "@/modules/reporting/ui/server";
import { routeScreen } from "@/shared/ui/api/route-screen";

export async function generateMetadata() {
  return { title: (await getTranslations("reports"))("calendar.metaTitle") };
}

/** #150: what comes in and goes out over the next 30 or 60 days, `?days=30|60` (ruling P241 of M6c). */
export default routeScreen<{ spaceId: string }, { days?: string }>(({ spaceId }, { days }) =>
  CalendarContainer({ spaceId, days }),
);
