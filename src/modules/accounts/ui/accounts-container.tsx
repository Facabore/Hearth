import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { AccountListDto } from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { AccountsScreen } from "./accounts-screen";

/** Every account of the space, archived ones included (they have their own section). */
export const loadAccounts = (api: Api, spaceId: string): Promise<Loaded<AccountListDto>> =>
  loaded(
    api.GET("/api/v1/spaces/{spaceId}/accounts", {
      params: { path: { spaceId }, query: { archived: "true" } },
    }),
  );

/** Server: the accounts screen of a space, in the person's formats. */
export async function AccountsContainer({
  spaceId,
  returnTo,
}: {
  readonly spaceId: string;
  /** The screen this one was opened from (`?returnTo=`); the screen validates it. */
  readonly returnTo?: string;
}) {
  const [me, spaces, accounts] = await Promise.all([
    getMe(),
    getSpaces(),
    loadAccounts(await serverApi(), spaceId),
  ]);
  if (!accounts.ok) return <ProblemNotice problem={accounts.problem} />;
  const space = spaces.find((s) => s.id === spaceId);
  return (
    <AccountsScreen
      spaceId={spaceId}
      kind={space?.kind}
      role={space?.role}
      list={accounts.data}
      formats={me!.preferences.effective}
      returnTo={returnTo}
    />
  );
}
