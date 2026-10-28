import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { AccountsScreen, EditAccountForm, NewAccountForm } from "@/modules/accounts/ui";
import { useApis } from "../api";
import { useViewer } from "../viewer";
import { accountListQuery, accountQuery } from "../queries";
import { useTitle } from "../title";

const list = getRouteApi("/spaces/$spaceId/accounts");
const create = getRouteApi("/spaces/$spaceId/accounts/new");
const edit = getRouteApi("/spaces/$spaceId/accounts/$accountId/edit");

/** HU-E9-03: the accounts of a space, archived ones in their own section, from the query cache (ADR 0006). */
export function AccountsRoute() {
  useTitle(useTranslations("accounts")("title"));
  const { spaceId } = list.useParams();
  const { returnTo } = list.useSearch();
  const { api } = useApis();
  const { me, space } = useViewer(spaceId);
  const accounts = useSuspenseQuery(accountListQuery(api, spaceId, "all")).data;
  return (
    <AccountsScreen
      spaceId={spaceId}
      kind={space.kind}
      role={space.role}
      list={accounts}
      formats={me.preferences.effective}
      returnTo={returnTo}
    />
  );
}

/** HU-E9-03: create an account in the space, in the person's number format. */
export function NewAccountRoute() {
  useTitle(useTranslations("accounts")("newTitle"));
  const { spaceId } = create.useParams();
  const { returnTo } = create.useSearch();
  const { me, space } = useViewer(spaceId);
  return <NewAccountForm space={space} formats={me.preferences.effective} returnTo={returnTo} />;
}

/** Issue 169: edit an account's name, opening balance, icon, attributes and switches. */
export function EditAccountRoute() {
  useTitle(useTranslations("accounts.edit")("title"));
  const { spaceId, accountId } = edit.useParams();
  const { api } = useApis();
  const { me, space } = useViewer(spaceId);
  const account = useSuspenseQuery(accountQuery(api, spaceId, accountId)).data;
  return <EditAccountForm space={space} account={account} formats={me.preferences.effective} />;
}
