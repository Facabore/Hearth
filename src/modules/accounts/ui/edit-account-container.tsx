import { notFound } from "next/navigation";
import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { AccountDto } from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { EditAccountForm } from "./edit-account-form";

/** Issue 169: one account with its stored and default style (#120, P253). */
export const loadAccount = (api: Api, spaceId: string, accountId: string): Promise<Loaded<AccountDto>> =>
  loaded(
    api.GET("/api/v1/spaces/{spaceId}/accounts/{accountId}", { params: { path: { spaceId, accountId } } }),
  );

/** Server: the edit form of one account, in the person's formats; an account or space that is gone is not found. */
export async function EditAccountContainer({
  spaceId,
  accountId,
}: {
  readonly spaceId: string;
  readonly accountId: string;
}) {
  const [me, spaces, account] = await Promise.all([
    getMe(),
    getSpaces(),
    loadAccount(await serverApi(), spaceId, accountId),
  ]);
  if (!account.ok && account.problem.status === 404) notFound();
  if (!account.ok) return <ProblemNotice problem={account.problem} />;
  const space = spaces.find((s) => s.id === spaceId) ?? notFound();
  return <EditAccountForm space={space} account={account.data} formats={me!.preferences.effective} />;
}
