import { getTranslations } from "next-intl/server";
import { RecordFormContainer } from "@/modules/ledger/ui/server";
import { routeScreen } from "@/shared/ui/api/route-screen";

export async function generateMetadata() {
  return { title: (await getTranslations("ledger.form"))("title") };
}

const KINDS = { income: "INCOME", transfer: "TRANSFER" } as const;

/**
 * HU-E9-03: record an expense, an income or a transfer (`?type=expense|income|transfer`). Issue #172: `?returnTo=` is
 * the screen it was opened from, where saving lands.
 */
export default routeScreen<{ spaceId: string }, { type?: string; returnTo?: string | string[] }>(
  async ({ spaceId }, { type, returnTo }) => (
    <div className="mx-auto max-w-[560px]">
      {await RecordFormContainer({
        spaceId,
        kind: KINDS[type as keyof typeof KINDS] ?? "EXPENSE",
        returnTo: typeof returnTo === "string" ? returnTo : null,
      })}
    </div>
  ),
);
