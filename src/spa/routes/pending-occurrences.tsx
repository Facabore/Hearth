import { getRouteApi } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { PendingOccurrencesScreen } from "@/modules/ledger/ui/screens";
import { usePendingItems, usePendingWrites } from "../recurring-pending/hooks";
import { useTitle } from "../title";
import { useViewer } from "../viewer";

const route = getRouteApi("/spaces/$spaceId/pending-occurrences");

/**
 * HU-E9-09 (ruling P270): "Por confirmar", a stacked screen of the space opened from the Movimientos banner. A member
 * who records money confirms or skips each pending occurrence; a VIEWER reads them with the role note (S6).
 */
export function PendingOccurrencesRoute() {
  useTitle(useTranslations("recurrences.pending")("title"));
  const viewer = useViewer(route.useParams().spaceId);
  const { items, canAct } = usePendingItems(viewer);
  const { confirm, skip } = usePendingWrites(viewer.space.id);
  return (
    <PendingOccurrencesScreen
      key={viewer.space.id}
      space={viewer.space}
      items={items}
      formats={viewer.me.preferences.effective}
      canAct={canAct}
      onConfirm={confirm}
      onSkip={skip}
    />
  );
}
