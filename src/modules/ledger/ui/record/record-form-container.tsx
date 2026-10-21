import { notFound } from "next/navigation";
import { ProblemNotice } from "@/shared/ui";
import { getMe, getSpaces, loaded, serverApi } from "@/shared/ui/api/server";
import { serverNow } from "@/shared/ui/time/server-now";
import { RecordForm } from "./record-form";
import type { RecordKind } from "./record-request";

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
  return (
    <RecordForm
      space={space}
      accounts={accounts.data.items}
      groups={categories.data.items}
      formats={me!.preferences.effective}
      initialKind={kind}
      initialNow={serverNow().toISOString()}
      profileZone={me!.timezone}
    />
  );
}
