import { notFound, redirect } from "next/navigation";
import { personalSpaceOf } from "@/modules/spaces/ui";
import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { AccountDto, CategoryGroupDto, MeDto, SpaceDto, TransactionDto } from "@/shared/ui/api/dto";
import { problemFrom } from "@/shared/ui/api/problem";
import { getMe, getSpaces, loaded, redirectToSignIn, serverApi, type Loaded } from "@/shared/ui/api/server";
import { serverNow } from "@/shared/ui/time/server-now";
import { actionsFor, type TransactionActions } from "../detail/transaction-actions";
import { withTx } from "../detail/tx-href";
import { loadSharedContext } from "../record/record-form-container";
import type { SharedExpenseContext } from "../split/shared-context";
import { EditTransactionForm } from "./edit-transaction-form";
import { originOf } from "./origin";

export interface EditContext {
  readonly me: MeDto;
  readonly space: SpaceDto;
  readonly tx: TransactionDto;
  /** The space's active accounts, plus those the transaction is recorded on even when archived (they keep their names). */
  readonly accounts: readonly AccountDto[];
  /** Every category, archived ones too: an old record still names its own. */
  readonly groups: readonly CategoryGroupDto[];
  readonly shared?: SharedExpenseContext;
  /** What the viewer may do with the transaction (ruling P190): the route refuses an edit the sheet would not offer. */
  readonly actions: TransactionActions;
}

const accountsOf = (tx: TransactionDto): ReadonlySet<string> =>
  new Set(
    [tx.sourceAccountId, tx.destinationAccountId, ...tx.payments.map((payment) => payment.accountId)].filter(
      (id): id is string => id !== null,
    ),
  );

/**
 * Ruling P191: what the edit route reads. The data is null when the transaction, the space or the viewer's membership is
 * gone, which the route answers with the not-found page.
 */
export const loadEditContext = async (
  api: Api,
  input: { readonly spaceId: string; readonly transactionId: string },
): Promise<Loaded<EditContext | null>> => {
  const path = { spaceId: input.spaceId };
  const [me, spaces, read, accounts, categories] = await Promise.all([
    getMe(),
    getSpaces(),
    api
      .GET("/api/v1/spaces/{spaceId}/transactions/{transactionId}", {
        params: { path: { ...path, transactionId: input.transactionId } },
      })
      .catch((error: unknown) => ({ data: undefined, error, response: undefined })),
    loaded(api.GET("/api/v1/spaces/{spaceId}/accounts", { params: { path, query: { archived: "true" } } })),
    loaded(api.GET("/api/v1/spaces/{spaceId}/categories", { params: { path, query: { archived: "true" } } })),
  ]);
  if (!me || read.response?.status === 401) return redirectToSignIn();
  if (read.response?.status === 404) return { ok: true, data: null };
  if (!read.data) return { ok: false, problem: problemFrom(read.error, read.response) };
  if (!accounts.ok) return accounts;
  if (!categories.ok) return categories;
  const space = spaces.find((s) => s.id === input.spaceId);
  if (!space) return { ok: true, data: null };
  const tx = read.data;
  let shared: SharedExpenseContext | undefined;
  if (space.kind !== "PERSONAL") {
    const context = await loadSharedContext(api, {
      spaceId: input.spaceId,
      meUserId: me.id,
      personalSpaceId: personalSpaceOf(spaces).id,
      spaceAccounts: accounts.data.items,
    });
    if (!context.ok) return context;
    if (!context.data) return { ok: true, data: null };
    shared = context.data;
  }
  const used = accountsOf(tx);
  return {
    ok: true,
    data: {
      me,
      space,
      tx,
      accounts: accounts.data.items.filter((a) => a.archivedAt === null || used.has(a.id)),
      groups: categories.data.items,
      ...(shared ? { shared } : {}),
      actions: actionsFor(
        tx,
        { userId: me.id, role: space.role, memberId: shared?.meMemberId ?? null },
        shared?.members ?? [],
      ),
    },
  };
};

/**
 * Server: the edit form of a transaction. `returnTo` is the screen the sheet was opened on (the list with its filter, or
 * the home); where the viewer may not edit, the route shows the sheet again instead.
 */
export async function EditTransactionContainer({
  spaceId,
  transactionId,
  returnTo,
}: {
  readonly spaceId: string;
  readonly transactionId: string;
  readonly returnTo: string | undefined;
}) {
  const result = await loadEditContext(await serverApi(), { spaceId, transactionId });
  if (!result.ok) return <ProblemNotice problem={result.problem} />;
  if (!result.data) notFound();
  const { me, space, tx, accounts, groups, shared, actions } = result.data;
  const origin = originOf(returnTo, spaceId);
  if (!actions.edit) redirect(withTx(origin, transactionId));
  return (
    <div className="mx-auto max-w-[560px]">
      <EditTransactionForm
        // A newer version remounts the form with its values, which is what "Cargar la última versión" relies on (P193).
        key={tx.version}
        space={space}
        tx={tx}
        accounts={accounts}
        groups={groups}
        formats={me.preferences.effective}
        profileZone={me.timezone}
        origin={origin}
        initialNow={serverNow().toISOString()}
        {...(shared ? { shared } : {})}
      />
    </div>
  );
}
