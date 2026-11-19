import { getRouteApi, useRouter } from "@tanstack/react-router";
import { lazy, useEffect } from "react";
import { useTranslations } from "use-intl";
import { actionsFor, EditTransactionForm, originOf, withTx } from "@/modules/ledger/ui";
import { NotFoundScreen, ProblemNotice } from "@/shared/ui";
import { useApis } from "../api";
import { useEdit } from "../ledger/form-hooks";
import { useViewer } from "../viewer";
import { useTitle } from "../title";

// P344 (ADR 0004, owner 2026-11-19): a payment's edit form loads only when a payment is edited.
const EditPaymentForm = lazy(() =>
  import("../ledger/edit-payment").then((module) => ({ default: module.EditPaymentForm })),
);

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
  const { shared } = edit;
  const actions = actionsFor(
    edit.tx,
    { userId: viewer.me.id, role: viewer.space.role, memberId: shared?.meMemberId ?? null },
    shared?.members ?? [],
  );
  if (!actions.edit) return <ShowSheet href={withTx(origin, transactionId)} />;
  // P344 (board 1): a payment between members is edited by its sides, not by the record form.
  if (edit.tx.type === "SETTLEMENT" && shared)
    return (
      <div className="mx-auto max-w-[560px]">
        <EditPaymentForm
          key={edit.tx.version}
          spaceId={viewer.space.id}
          tx={edit.tx}
          shared={shared}
          me={viewer.me}
          origin={origin}
          api={api}
        />
      </div>
    );
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
