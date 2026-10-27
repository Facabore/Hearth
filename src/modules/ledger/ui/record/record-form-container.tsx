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
    /** The space's own accounts; they only name things, so the reads above never wait for them (issue #196). */
    readonly spaceAccounts: readonly AccountDto[] | PromiseLike<readonly AccountDto[]>;
  },
): Promise<Loaded<SharedExpenseContext | null>> => {
  const [members, personal, spaceAccounts] = await Promise.all([
    loaded(api.GET("/api/v1/spaces/{spaceId}/members", { params: { path: { spaceId: input.spaceId } } })),
    loaded(
      api.GET("/api/v1/spaces/{spaceId}/accounts", { params: { path: { spaceId: input.personalSpaceId } } }),
    ),
    input.spaceAccounts,
  ]);
  if (!members.ok) return members;
  if (!personal.ok) return personal;
  return {
    ok: true,
    data: sharedContextOf({
      meUserId: input.meUserId,
      members: members.data.items,
      spaceAccounts,
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
  const viewer = Promise.all([getMe(), getSpaces()]);
  const accountsRead = loaded(api.GET("/api/v1/spaces/{spaceId}/accounts", { params: { path } }));
  // Issue #196: what needs only the person and their spaces starts as soon as they answer, beside the accounts and the
  // categories: the line watch (it never fails the form, P236), and the shared context or the people to split with.
  const found = viewer.then(([me, spaces]) => {
    const space = spaces.find((s) => s.id === spaceId);
    return space ? { me: me!, spaces, space } : null;
  });
  const watch = found.then((f) =>
    f ? loadLineWatch(api, { spaceId, today: nowIn(serverNow(), f.me.timezone).date }) : null,
  );
  const sharedRead = found.then((f) =>
    f && f.space.kind !== "PERSONAL"
      ? loadSharedContext(api, {
          spaceId,
          meUserId: f.me.id,
          personalSpaceId: personalSpaceOf(f.spaces).id,
          spaceAccounts: accountsRead.then((accounts) => (accounts.ok ? accounts.data.items : [])),
        })
      : undefined,
  );
  const peopleRead = found.then((f) =>
    f && f.space.kind === "PERSONAL" ? loadPeople(api, { meUserId: f.me.id, spaces: f.spaces }) : undefined,
  );
  // An early return below leaves these reads unawaited: they must never surface as unhandled rejections.
  for (const read of [watch, sharedRead, peopleRead]) void read.catch(() => undefined);
  const [[me, spaces], accounts, categories] = await Promise.all([
    viewer,
    accountsRead,
    loaded(api.GET("/api/v1/spaces/{spaceId}/categories", { params: { path } })),
  ]);
  const space = spaces.find((s) => s.id === spaceId) ?? notFound();
  if (!accounts.ok) return <ProblemNotice problem={accounts.problem} />;
  if (!categories.ok) return <ProblemNotice problem={categories.problem} />;
  let shared: SharedExpenseContext | undefined;
  const context = await sharedRead;
  if (context) {
    if (!context.ok) return <ProblemNotice problem={context.problem} />;
    shared = context.data ?? notFound();
  }
  const people = await peopleRead;
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
