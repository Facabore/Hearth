import { getRouteApi } from "@tanstack/react-router";
import { lazy, Suspense, useDeferredValue, useState } from "react";
import { useTranslations } from "use-intl";
import { RecordForm, RecordNotAllowed } from "@/modules/ledger/ui";
import { controlsFor } from "@/modules/spaces/ui";
import { safeReturnTo } from "@/shared/ui/navigation/auth-redirect";
import { useApis } from "../api";
import { useRecord } from "../ledger/form-hooks";
import { useViewer } from "../viewer";
import { useHoldNavigation } from "../ledger/hold-navigation";
import type { Viewer } from "../load";
import { useTitle } from "../title";
import { QuietBoundary } from "../quiet-boundary";

const route = getRouteApi("/spaces/$spaceId/new");

const KINDS = { income: "INCOME", transfer: "TRANSFER" } as const;

// Ruling P300: the screen behind the sheet loads apart, once the sheet is on screen (ADR 0004).
const RecordBehind = lazy(() =>
  import("../ledger/record-behind").then((module) => ({ default: module.RecordBehind })),
);

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
  const holdNavigation = useHoldNavigation();
  // Ruling P300: the screen it was opened from, dimmed under the scrim, in a render after the sheet's first.
  const sheetShown = useDeferredValue(true, false);
  return (
    <div className="mx-auto max-w-[560px]">
      {sheetShown ? (
        // A backdrop that fails to load or to draw shows nothing; the form never goes down with it.
        <QuietBoundary>
          <Suspense fallback={null}>
            <RecordBehind viewer={viewer} returnTo={returnTo} />
          </Suspense>
        </QuietBoundary>
      ) : null}
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
        holdNavigation={holdNavigation}
        api={api}
      />
    </div>
  );
}
