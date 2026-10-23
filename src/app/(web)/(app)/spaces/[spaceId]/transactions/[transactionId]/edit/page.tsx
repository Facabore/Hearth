import { getTranslations } from "next-intl/server";
import { EditTransactionContainer } from "@/modules/ledger/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("ledger.edit"))("title") };
}

/**
 * Ruling P191: edit a transaction. `?returnTo=` is the screen its sheet was opened on (the list with its filter, or the
 * home), validated before use; saving or going back shows that sheet again.
 */
export default async function EditTransactionPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ spaceId: string; transactionId: string }>;
  readonly searchParams: Promise<{ returnTo?: string }>;
}) {
  const [{ spaceId, transactionId }, { returnTo }] = await Promise.all([params, searchParams]);
  return <EditTransactionContainer spaceId={spaceId} transactionId={transactionId} returnTo={returnTo} />;
}
