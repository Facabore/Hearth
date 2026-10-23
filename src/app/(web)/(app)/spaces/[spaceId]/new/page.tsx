import { getTranslations } from "next-intl/server";
import { RecordFormContainer } from "@/modules/ledger/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("ledger.form"))("title") };
}

const KINDS = { income: "INCOME", transfer: "TRANSFER" } as const;

/** HU-E9-03: record an expense, an income or a transfer (`?type=expense|income|transfer`). */
export default async function NewTransactionPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ spaceId: string }>;
  readonly searchParams: Promise<{ type?: string }>;
}) {
  const [{ spaceId }, { type }] = await Promise.all([params, searchParams]);
  return (
    <div className="mx-auto max-w-[560px]">
      <RecordFormContainer spaceId={spaceId} kind={KINDS[type as keyof typeof KINDS] ?? "EXPENSE"} />
    </div>
  );
}
