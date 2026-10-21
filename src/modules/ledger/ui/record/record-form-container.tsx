import { notFound } from "next/navigation";
import { personalSpaceOf } from "@/modules/spaces/ui";
import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { AccountDto } from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { serverNow } from "@/shared/ui/time/server-now";
import { sharedContextOf, type SharedExpenseContext } from "../split/shared-context";
import { RecordForm } from "./record-form";
import type { RecordKind } from "./record-request";

/**
 * HU-E9-06 (P168): who can pay and who shares an expense of a shared or direct space: its members and the accounts the
 * recorder owns. The data is null when the person is not a current member.
 */
export const loadSharedContext = async (
  api: Api,
  input: {
    readonly spaceId: string;
    readonly meUserId: string;
    readonly personalSpaceId: string;
    readonly spaceAccounts: readonly AccountDto[];
  },
): Promise<Loaded<SharedExpenseContext | null>> => {
  const [members, personal] = await Promise.all([
    loaded(api.GET("/api/v1/spaces/{spaceId}/members", { params: { path: { spaceId: input.spaceId } } })),
    loaded(
      api.GET("/api/v1/spaces/{spaceId}/accounts", { params: { path: { spaceId: input.personalSpaceId } } }),
    ),
  ]);
  if (!members.ok) return members;
  if (!personal.ok) return personal;
  return {
    ok: true,
    data: sharedContextOf({
      meUserId: input.meUserId,
      members: members.data.items,
      spaceAccounts: input.spaceAccounts,
      personalAccounts: personal.data.items,
    }),
  };
};

/** Server: the space, its active accounts and categories, and the render's instant for the form's first clock. */
export async function RecordFormContainer({
  spaceId,
  kind,
}: {
  readonly spaceId: string;
  readonly kind: RecordKind;
}) {
  const api = await serverApi();
  const path = { spaceId };
  const [me, spaces, accounts, categories] = await Promise.all([
    getMe(),
    getSpaces(),
    loaded(api.GET("/api/v1/spaces/{spaceId}/accounts", { params: { path } })),
    loaded(api.GET("/api/v1/spaces/{spaceId}/categories", { params: { path } })),
  ]);
  const space = spaces.find((s) => s.id === spaceId) ?? notFound();
  if (!accounts.ok) return <ProblemNotice problem={accounts.problem} />;
  if (!categories.ok) return <ProblemNotice problem={categories.problem} />;
  let shared: SharedExpenseContext | undefined;
  if (space.kind !== "PERSONAL") {
    const context = await loadSharedContext(api, {
      spaceId,
      meUserId: me!.id,
      personalSpaceId: personalSpaceOf(spaces).id,
      spaceAccounts: accounts.data.items,
    });
    if (!context.ok) return <ProblemNotice problem={context.problem} />;
    shared = context.data ?? notFound();
  }
  return (
    <RecordForm
      space={space}
      accounts={accounts.data.items}
      groups={categories.data.items}
      formats={me!.preferences.effective}
      initialKind={kind}
      initialNow={serverNow().toISOString()}
      profileZone={me!.timezone}
      {...(shared ? { shared } : {})}
    />
  );
}
