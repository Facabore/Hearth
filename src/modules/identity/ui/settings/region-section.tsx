"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge, Button } from "@/shared/ui";
import type { Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { zoneCity, zoneOffset } from "@/shared/ui/format/zones";
import { LockBadge } from "./lock-badge";
import { SavedFlash } from "@/shared/ui/molecules/saved-flash";
import { SummaryRow } from "./summary-row";
import { TimeZoneSheet } from "./time-zone-sheet";

/**
 * HU-E9-13: the time zone row; the design's currency row is not built (ruling P126). Decision U8 (#224): it is one of
 * the screen's summary rows, its zone and offset under its title, and it opens the zone sheet.
 */
export function RegionSection({
  timezone,
  state,
  onChoose,
  onReset,
  problem,
  saved = false,
}: {
  readonly timezone: string;
  readonly state: "locked" | "default" | "custom";
  readonly onChoose: (zone: string) => void;
  readonly onReset: () => void;
  readonly problem: Problem | null;
  /** U5: the zone was just stored. */
  readonly saved?: boolean;
}) {
  const t = useTranslations("settings");
  const messageOf = useProblemMessage();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex flex-col gap-1">
      <SavedFlash show={saved} className="-top-5" />
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <SummaryRow
            title={t("field.timezone")}
            value={`${zoneCity(timezone)} (${zoneOffset(timezone, new Date())})`}
            disabled={state === "locked"}
            onOpen={() => setOpen(true)}
            describedBy="settings-timezone-hint"
          />
        </div>
        {state === "locked" ? (
          <LockBadge />
        ) : state === "default" ? (
          <Badge>{t("default")}</Badge>
        ) : (
          <Button variant="ghost" size="compact" onClick={onReset}>
            {t("reset")}
          </Button>
        )}
      </div>
      <p id="settings-timezone-hint" className="text-sm text-muted">
        {t("timezone.hint")}
      </p>
      {problem ? <p className="text-sm text-danger">{messageOf(problem).message}</p> : null}
      <TimeZoneSheet open={open} onOpenChange={setOpen} value={timezone} onChoose={onChoose} />
    </div>
  );
}
