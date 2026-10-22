"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge, Button, Icon } from "@/shared/ui";
import type { Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { zoneCity, zoneOffset } from "@/shared/ui/format/zones";
import { LockBadge } from "./lock-badge";
import { SavedFlash } from "./saved-flash";
import { TimeZoneSheet } from "./time-zone-sheet";

/** HU-E9-13: the time zone row; the design's currency row is not built (ruling P126). */
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
    <section aria-labelledby="settings-region" className="relative flex flex-col gap-3">
      <SavedFlash show={saved} className="top-0" />
      <h2 id="settings-region" className="text-lg font-semibold text-ink">
        {t("region")}
      </h2>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          disabled={state === "locked"}
          onClick={() => setOpen(true)}
          aria-describedby="settings-timezone-hint"
          className="flex min-h-14 flex-1 items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 text-left disabled:opacity-50"
        >
          <span className="flex flex-col">
            <span className="text-sm font-medium text-ink">{t("field.timezone")}</span>
            <span className="text-muted">
              {zoneCity(timezone)} ({zoneOffset(timezone, new Date())})
            </span>
          </span>
          <Icon name="chevronRight" size={20} />
        </button>
        {state === "locked" ? (
          <LockBadge />
        ) : state === "default" ? (
          <Badge>{t("default")}</Badge>
        ) : (
          <Button variant="ghost" className="h-11 px-2 text-sm" onClick={onReset}>
            {t("reset")}
          </Button>
        )}
      </div>
      <p id="settings-timezone-hint" className="text-sm text-muted">
        {t("timezone.hint")}
      </p>
      {problem ? <p className="text-sm text-danger">{messageOf(problem).message}</p> : null}
      <TimeZoneSheet open={open} onOpenChange={setOpen} value={timezone} onChoose={onChoose} />
    </section>
  );
}
