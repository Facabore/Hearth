import { getTranslations } from "next-intl/server";
import { RecordFormContainer } from "@/modules/ledger/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("ledger.form"))("title") };
}

const KINDS = { income: "INCOME", transfer: "TRANSFER" } as const;

/**
 * HU-E9-03: record an expense, an income or a transfer (`?type=expense|income|transfer`). Issue #172: `?returnTo=` is
 * the screen it was opened from, where saving lands.
 */
export default async function NewTransactionPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ spaceId: string }>;
  readonly searchParams: Promise<{ type?: string; returnTo?: string | string[] }>;
}) {
  const [{ spaceId }, { type, returnTo }] = await Promise.all([params, searchParams]);
  return (
    <div className="mx-auto max-w-[560px]">
      <RecordFormContainer
        spaceId={spaceId}
        kind={KINDS[type as keyof typeof KINDS] ?? "EXPENSE"}
        returnTo={typeof returnTo === "string" ? returnTo : null}
      />
    </div>
  );
}
