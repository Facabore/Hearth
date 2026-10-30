import { getRouteApi, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslations } from "use-intl";
import { EditTransactionForm, originOf, withTx } from "@/modules/ledger/ui";
import { NotFoundScreen, ProblemNotice } from "@/shared/ui";
import { useApis } from "../api";
import { useEdit } from "../ledger/form-hooks";
import { useViewer } from "../viewer";
import { useTitle } from "../title";

const route = getRouteApi("/spaces/$spaceId/transactions/$transactionId/edit");

/** Where the viewer may not edit, the route shows the sheet again instead (ruling P190), replacing this entry. */
function ShowSheet({ href }: { readonly href: string }) {
  const router = useRouter();
  useEffect(() => {
    void router.navigate({ href, replace: true });
  }, [router, href]);
  return null;
}

/**
 * Ruling P191: edit a transaction. `?returnTo=` is the screen its sheet was opened on, validated before use; saving or
 * going back shows that sheet again, and so does a transaction the viewer may not edit.
 */
export function EditTransactionScreen() {
  useTitle(useTranslations("ledger.edit")("title"));
  const { spaceId, transactionId } = route.useParams();
  const { returnTo } = route.useSearch();
  const { api } = useApis();
  const viewer = useViewer(spaceId);
  const edit = useEdit(viewer, transactionId);
  if (edit.missing) return <NotFoundScreen />;
  if (!edit.tx) return <ProblemNotice problem={edit.problem} />;
  const origin = originOf(returnTo, spaceId);
  if (!edit.actions.edit) return <ShowSheet href={withTx(origin, transactionId)} />;
  return (
    <div className="mx-auto max-w-[560px]">
      <EditTransactionForm
        // A newer version remounts the form with its values, which is what "Cargar la última versión" relies on (P193).
        key={edit.tx.version}
        space={viewer.space}
        tx={edit.tx}
        accounts={edit.accounts}
        groups={edit.groups}
        formats={viewer.me.preferences.effective}
        profileZone={viewer.me.timezone}
        origin={origin}
        {...(edit.shared ? { shared: edit.shared } : {})}
        api={api}
      />
    </div>
  );
}
