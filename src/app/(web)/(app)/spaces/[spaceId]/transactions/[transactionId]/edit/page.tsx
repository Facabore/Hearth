import { getTranslations } from "next-intl/server";
import { EditTransactionContainer } from "@/modules/ledger/ui/server";
import { routeScreen } from "@/shared/ui/api/route-screen";

export async function generateMetadata() {
  return { title: (await getTranslations("ledger.edit"))("title") };
}

/**
 * Ruling P191: edit a transaction. `?returnTo=` is the screen its sheet was opened on (the list with its filter, or the
 * home), validated before use; saving or going back shows that sheet again.
 */
export default routeScreen<{ spaceId: string; transactionId: string }, { returnTo?: string }>(
  ({ spaceId, transactionId }, { returnTo }) =>
    EditTransactionContainer({ spaceId, transactionId, returnTo }),
);
