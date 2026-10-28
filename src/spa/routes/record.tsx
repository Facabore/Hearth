import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { RecordForm } from "@/modules/ledger/ui";
import { useApis } from "../api";
import { useRecord, useViewer } from "../ledger/hooks";
import { useTitle } from "../title";

const route = getRouteApi("/spaces/$spaceId/new");

const KINDS = { income: "INCOME", transfer: "TRANSFER" } as const;

/**
 * HU-E9-03: record an expense, an income or a transfer (`?type=expense|income|transfer`). Issue #172: `?returnTo=` is
 * the screen it was opened from, where saving lands.
 */
export function RecordScreen() {
  useTitle(useTranslations("ledger.form")("title"));
  const { spaceId } = route.useParams();
  const { type, returnTo } = route.useSearch();
  const { api } = useApis();
  const viewer = useViewer(spaceId);
  const { accounts, groups, shared, people, lineWatch } = useRecord(viewer);
  const [now] = useState(() => new Date().toISOString());
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
        api={api}
      />
    </div>
  );
}
