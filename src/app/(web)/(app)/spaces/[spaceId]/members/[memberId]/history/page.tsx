import { getTranslations } from "next-intl/server";
import { HistoryContainer } from "@/modules/balances/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("balances.history"))("pageTitle") };
}

/** HU-E9-07: a member's running balance over a period of the space, `?from=<date>` for another period (P176). */
export default async function BalanceHistoryPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ spaceId: string; memberId: string }>;
  readonly searchParams: Promise<{ from?: string }>;
}) {
  const [{ spaceId, memberId }, { from }] = await Promise.all([params, searchParams]);
  return (
    <div className="mx-auto max-w-[720px] py-4">
      <HistoryContainer
        spaceId={spaceId}
        memberId={memberId}
        from={typeof from === "string" ? from : undefined}
      />
    </div>
  );
}
