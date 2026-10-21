import { getTranslations } from "next-intl/server";
import { TransactionListContainer } from "@/modules/ledger/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("ledger.list"))("title") };
}

/** HU-E9-03: the transactions of a space, `?period=<label>&category=<id>`. */
export default async function TransactionsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ spaceId: string }>;
  readonly searchParams: Promise<{ period?: string; category?: string; notice?: string; account?: string }>;
}) {
  const [{ spaceId }, { period, category, notice, account }] = await Promise.all([params, searchParams]);
  return (
    <TransactionListContainer
      spaceId={spaceId}
      period={period}
      categoryId={category}
      notice={notice}
      noticeAccount={account}
    />
  );
}
