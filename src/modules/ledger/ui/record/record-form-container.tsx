import { notFound } from "next/navigation";
import { personalSpaceOf } from "@/modules/spaces/ui";
import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { AccountDto, MemberDto, SpaceDto } from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { serverNow } from "@/shared/ui/time/server-now";
import { nowIn } from "@/shared/ui/time/when";
import { peopleOf, type Person } from "../direct/counterparts";
import { sharedContextOf, type SharedExpenseContext } from "../split/shared-context";
import { lineWatchOf, type LineWatch } from "./line-watch";
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

/**
 * HU-E9-06 (P172): the people a personal expense can be split with, read from the members of every other space of the
 * recorder. A space whose members cannot be read leaves its people out instead of failing the form.
 */
export const loadPeople = async (
  api: Api,
  input: { readonly meUserId: string; readonly spaces: readonly SpaceDto[] },
): Promise<Person[]> => {
  const others = input.spaces.filter((space) => space.kind !== "PERSONAL");
  const reads = await Promise.all(
    others.map(async (space) => ({
      id: space.id,
      read: await loaded(
        api.GET("/api/v1/spaces/{spaceId}/members", { params: { path: { spaceId: space.id } } }),
      ),
    })),
  );
  const membersBySpace: Record<string, readonly MemberDto[]> = {};
  for (const { id, read } of reads) if (read.ok) membersBySpace[id] = read.data.items;
  return peopleOf({ meUserId: input.meUserId, spaces: others, membersBySpace });
};

/**
 * #142 (P236): the line dashboard of the space's period holding `today`, as a watch for the record form. A failed
 * read, a period without a plan or a plan that is not ACTIVE gives no watch, and the form simply warns of nothing.
 */
export const loadLineWatch = async (
  api: Api,
  input: { readonly spaceId: string; readonly today: string },
): Promise<LineWatch | null> => {
  const path = { spaceId: input.spaceId };
  const periods = await loaded(
    api.GET("/api/v1/spaces/{spaceId}/periods", { params: { path, query: { from: input.today, count: 1 } } }),
  );
  const label = periods.ok ? periods.data.items[0]?.label : undefined;
  if (label === undefined) return null;
  const dashboard = await loaded(
    api.GET("/api/v1/spaces/{spaceId}/reports/lines", { params: { path, query: { period: label } } }),
  );
  return dashboard.ok ? lineWatchOf(dashboard.data) : null;
};

/** Server: the space, its active accounts and categories, and the render's instant for the form's first clock. */
export async function RecordFormContainer({
  spaceId,
  kind,
  returnTo = null,
}: {
  readonly spaceId: string;
  readonly kind: RecordKind;
  /** Issue #172: the screen the form was opened from; the form validates it before using it. */
  readonly returnTo?: string | null;
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
  // Read while the shared context and the people load; it never fails the form (P236).
  const watch = loadLineWatch(api, { spaceId, today: nowIn(serverNow(), me!.timezone).date });
  // An early return below leaves the read unawaited: it must never surface as an unhandled rejection.
  void watch.catch(() => undefined);
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
  const people = space.kind === "PERSONAL" ? await loadPeople(api, { meUserId: me!.id, spaces }) : undefined;
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
      {...(people ? { people } : {})}
      lineWatch={await watch}
      returnTo={returnTo}
    />
  );
}
