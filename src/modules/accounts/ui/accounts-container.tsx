import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { AccountListDto } from "@/shared/ui/api/dto";
import { getMe, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { AccountsScreen } from "./accounts-screen";

/** Every account of the space, archived ones included (they have their own section). */
export const loadAccounts = (api: Api, spaceId: string): Promise<Loaded<AccountListDto>> =>
  loaded(
    api.GET("/api/v1/spaces/{spaceId}/accounts", {
      params: { path: { spaceId }, query: { archived: "true" } },
    }),
  );

/** Server: the accounts screen of a space, in the person's formats. */
export async function AccountsContainer({ spaceId }: { readonly spaceId: string }) {
  const [me, accounts] = await Promise.all([getMe(), loadAccounts(await serverApi(), spaceId)]);
  if (!accounts.ok) return <ProblemNotice problem={accounts.problem} />;
  return <AccountsScreen spaceId={spaceId} list={accounts.data} formats={me!.preferences.effective} />;
}
