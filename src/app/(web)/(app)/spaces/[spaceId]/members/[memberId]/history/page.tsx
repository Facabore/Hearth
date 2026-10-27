import { getTranslations } from "next-intl/server";
import { HistoryContainer } from "@/modules/balances/ui/server";
import { routeScreen } from "@/shared/ui/api/route-screen";

export async function generateMetadata() {
  return { title: (await getTranslations("balances.history"))("pageTitle") };
}

/** HU-E9-07: a member's running balance over a period of the space, `?from=<date>` for another period (P176). */
export default routeScreen<{ spaceId: string; memberId: string }, { from?: string }>(
  async ({ spaceId, memberId }, { from }) => (
    <div className="mx-auto max-w-[720px] py-3">
      {await HistoryContainer({ spaceId, memberId, from: typeof from === "string" ? from : undefined })}
    </div>
  ),
);
