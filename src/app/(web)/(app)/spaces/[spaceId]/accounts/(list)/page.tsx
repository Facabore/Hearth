import { getTranslations } from "next-intl/server";
import { AccountsContainer } from "@/modules/accounts/ui/server";
import { routeScreen } from "@/shared/ui/api/route-screen";

export async function generateMetadata() {
  return { title: (await getTranslations("accounts"))("title") };
}

/** HU-E9-03: the accounts of a space. */
export default routeScreen<{ spaceId: string }, { returnTo?: string }>(({ spaceId }, { returnTo }) =>
  AccountsContainer({ spaceId, returnTo }),
);
