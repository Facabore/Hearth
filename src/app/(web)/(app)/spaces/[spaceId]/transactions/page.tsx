import { getTranslations } from "next-intl/server";
import { TransactionListContainer } from "@/modules/ledger/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("ledger.list"))("title") };
}

/** HU-E9-03: the transactions of a space, `?period=<label>&category=<id>`; `?tx=<id>` opens its detail sheet (P189). */
export default async function TransactionsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ spaceId: string }>;
  readonly searchParams: Promise<{
    period?: string;
    category?: string;
    notice?: string;
    account?: string;
    tx?: string;
  }>;
}) {
  const [{ spaceId }, { period, category, notice, account, tx }] = await Promise.all([params, searchParams]);
  return (
    <TransactionListContainer
      spaceId={spaceId}
      period={period}
      categoryId={category}
      notice={notice}
      noticeAccount={account}
      transactionId={tx}
    />
  );
}
