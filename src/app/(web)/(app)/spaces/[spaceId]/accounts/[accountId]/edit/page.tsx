import { getTranslations } from "next-intl/server";
import { EditAccountContainer } from "@/modules/accounts/ui/server";
import { routeScreen } from "@/shared/ui/api/route-screen";

export async function generateMetadata() {
  return { title: (await getTranslations("accounts.edit"))("title") };
}

/** Issue 169: edit an account's name, opening balance, icon, attributes and switches. */
export default routeScreen<{ spaceId: string; accountId: string }>(({ spaceId, accountId }) =>
  EditAccountContainer({ spaceId, accountId }),
);
