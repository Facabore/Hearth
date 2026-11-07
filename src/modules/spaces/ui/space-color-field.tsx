"use client";

import { useTranslations } from "next-intl";
import type { PaletteKey } from "@/shared/kernel/style";
import { SpaceChip } from "@/shared/ui/atoms/space-chip";
import { ColorRow } from "@/shared/ui/molecules/color-row";

/**
 * Ruling P306 (board "Ajustes · Tu espacio: nombre y color"): the space's color in Ajustes, the palette's swatches and
 * how its chip reads in the personal feed. Its own chunk under the name's field, so the section keeps its budget (ADR
 * 0004) and its arrival moves nothing above it; `SpaceNameSection` stores what is picked.
 */
export function SpaceColorField({
  value,
  onValueChange,
  name,
}: {
  readonly value: PaletteKey;
  readonly onValueChange: (value: PaletteKey) => void;
  /** The space's name as the chip shows it. */
  readonly name: string;
}) {
  const t = useTranslations("settings.spaceColor");
  return (
    <div className="flex flex-col gap-2">
      <ColorRow
        value={value}
        onValueChange={onValueChange}
        hint={t("hint")}
        label={t("colorLabel")}
        colorName={(key) => t(`color.${key}`)}
      />
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
        {t("preview")} <SpaceChip name={name} color={value} />
      </p>
    </div>
  );
}
