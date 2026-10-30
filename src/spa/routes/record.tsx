import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { RecordForm, RecordNotAllowed } from "@/modules/ledger/ui";
import { controlsFor } from "@/modules/spaces/ui";
import { safeReturnTo } from "@/shared/ui/navigation/auth-redirect";
import { useApis } from "../api";
import { useRecord, useViewer } from "../ledger/hooks";
import { useLeaveGuard } from "../ledger/leave-guard";
import type { Viewer } from "../load";
import { useTitle } from "../title";

const route = getRouteApi("/spaces/$spaceId/new");

const KINDS = { income: "INCOME", transfer: "TRANSFER" } as const;

/**
 * HU-E9-03: record an expense, an income or a transfer (`?type=expense|income|transfer`). Issue #172: `?returnTo=` is
 * the screen it was opened from, where saving lands. Issue #207: someone who cannot record here reads why instead.
 */
export function RecordScreen() {
  useTitle(useTranslations("ledger.form")("title"));
  const { spaceId } = route.useParams();
  const { type, returnTo } = route.useSearch();
  const viewer = useViewer(spaceId);
  const { space } = viewer;
  if (!controlsFor(space.role, space.kind).recordMoney)
    return (
      <div className="mx-auto max-w-[560px]">
        <RecordNotAllowed space={space} backHref={safeReturnTo(returnTo) ?? `/spaces/${space.id}`} />
      </div>
    );
  return <RecordFormScreen viewer={viewer} type={type} returnTo={returnTo} />;
}

/** The form itself, for someone who records in the space, on the viewer the gate already read. */
function RecordFormScreen({
  viewer,
  type,
  returnTo,
}: {
  readonly viewer: Viewer;
  readonly type: string | undefined;
  readonly returnTo: string | undefined;
}) {
  const spaceId = viewer.space.id;
  const { api } = useApis();
  const { accounts, groups, shared, people, lineWatch } = useRecord(viewer);
  const [now] = useState(() => new Date().toISOString());
  const leaveGuard = useLeaveGuard();
  return (
    <div className="mx-auto max-w-[560px]">
      <RecordForm
        key={spaceId}
        space={viewer.space}
        accounts={accounts}
        groups={groups}
        formats={viewer.me.preferences.effective}
        initialKind={KINDS[type as keyof typeof KINDS] ?? "EXPENSE"}
        initialNow={now}
        profileZone={viewer.me.timezone}
        {...(shared ? { shared } : {})}
        {...(people ? { people } : {})}
        lineWatch={lineWatch}
        returnTo={returnTo ?? null}
        leaveGuard={leaveGuard}
        api={api}
      />
    </div>
  );
}
