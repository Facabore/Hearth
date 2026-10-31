import { useTranslations } from "next-intl";
import { PeriodSwitcher, ScreenHeader, usePeriodText } from "@/shared/ui";
import type { PeriodDto, SpaceDto, UnifiedViewDto } from "@/shared/ui/api/dto";
import type { Formats } from "@/shared/ui/format/formatters";
import { myConsumptionHref } from "../views";
import { UnifiedView } from "./unified-view";

/**
 * Decisions U10 and U4, ruling P267: Mi consumo as a stacked screen of the personal space, opened from Inicio's
 * shortcut. Its way back leads home, it keeps the period between its neighbours, and it wears no Plan tabs, since it
 * is not one of the tab's views any more.
 */
export function MyConsumptionScreen({
  space,
  view,
  previous,
  next,
  formats,
}: {
  readonly space: SpaceDto;
  readonly view: UnifiedViewDto;
  readonly previous: PeriodDto | null;
  readonly next: PeriodDto | null;
  readonly formats: Pick<Formats, "dateFormat" | "numberFormat">;
}) {
  const t = useTranslations("reports.view");
  const periodText = usePeriodText();
  return (
    <div className="mx-auto flex w-full max-w-[720px] min-w-0 flex-col gap-3 py-4">
      <ScreenHeader backHref={`/spaces/${space.id}`} title={t("mine")} />
      <PeriodSwitcher
        title={periodText(view.period, space.periodPolicy, formats)}
        previousHref={previous ? myConsumptionHref(space, previous.label) : null}
        nextHref={next ? myConsumptionHref(space, next.label) : null}
      />
      <UnifiedView view={view} formats={formats} />
    </div>
  );
}
