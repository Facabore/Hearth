"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { ChoiceGroup, Sheet, TextField } from "@/shared/ui";
import { allTimeZones, zoneCity, zoneOffset } from "@/shared/ui/format/zones";

/** A long list stays fast: at most this many matches are drawn (ruling P137). */
const MAX_SHOWN = 50;
const searchable = (text: string) => text.replaceAll("_", " ").toLowerCase();

/** HU-E9-13: every IANA zone the runtime knows, searched by name and city; choosing one closes the sheet. */
export function TimeZoneSheet({
  open,
  onOpenChange,
  value,
  onChoose,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly value: string;
  readonly onChoose: (zone: string) => void;
}) {
  const t = useTranslations("settings");
  const [query, setQuery] = useState("");
  const wanted = searchable(query.trim());
  const matches = allTimeZones()
    .filter((zone) => searchable(zone).includes(wanted) || searchable(zoneCity(zone)).includes(wanted))
    .slice(0, MAX_SHOWN);
  const now = new Date();
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
      title={t("field.timezone")}
    >
      <div className="flex flex-col gap-4">
        <TextField
          id="settings-timezone-search"
          label={t("timezone.search")}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
        {matches.length === 0 ? (
          <p className="text-sm text-muted">{t("timezone.none", { query: query.trim() })}</p>
        ) : (
          <ChoiceGroup
            label={t("field.timezone")}
            layout="chips"
            value={value}
            options={matches.map((zone) => ({
              value: zone,
              label: `${zoneCity(zone)} (${zoneOffset(zone, now)})`,
            }))}
            onValueChange={(zone) => {
              setQuery("");
              onChoose(zone);
              onOpenChange(false);
            }}
          />
        )}
      </div>
    </Sheet>
  );
}
