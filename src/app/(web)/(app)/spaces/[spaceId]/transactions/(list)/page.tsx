import { getTranslations } from "next-intl/server";
import { TransactionListContainer } from "@/modules/ledger/ui/server";
import { routeScreen } from "@/shared/ui/api/route-screen";

export async function generateMetadata() {
  return { title: (await getTranslations("ledger.list"))("title") };
}

/** HU-E9-03: the transactions of a space, `?period=<label>&category=<id>&payer=<member id>` (#148); `?tx=<id>` opens its detail sheet (P189). */
export default routeScreen<
  { spaceId: string },
  { period?: string; category?: string; payer?: string; notice?: string; account?: string; tx?: string }
>(({ spaceId }, { period, category, payer, notice, account, tx }) =>
  TransactionListContainer({
    spaceId,
    period,
    categoryId: category,
    payerMemberId: payer,
    notice,
    noticeAccount: account,
    transactionId: tx,
  }),
);
