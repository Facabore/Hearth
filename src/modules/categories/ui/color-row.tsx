"use client";

import { useTranslations } from "next-intl";
import { PALETTE, type PaletteKey } from "@/shared/kernel/style";
import { ChoiceGroup, paletteVars, VisuallyHidden } from "@/shared/ui";

/** HU-E9-04: the 16 palette keys of HU-E3-05 as swatches, each named by its localized label (D22). */
export function ColorRow({
  value,
  onValueChange,
}: {
  readonly value: PaletteKey;
  readonly onValueChange: (value: PaletteKey) => void;
}) {
  const t = useTranslations("categories");
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium text-ink">{t("colorLabel")}</legend>
      <ChoiceGroup
        label={t("colorLabel")}
        layout="swatches"
        value={value}
        onValueChange={onValueChange}
        options={PALETTE.map((key) => ({
          value: key,
          label: (
            <>
              <span
                aria-hidden="true"
                style={paletteVars(key)}
                className="size-8 rounded-full border border-[var(--ink)] bg-[var(--tint)]"
              />
              <VisuallyHidden>{t(`color.${key}`)}</VisuallyHidden>
            </>
          ),
        }))}
      />
    </fieldset>
  );
}
