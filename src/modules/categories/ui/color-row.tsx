"use client";

import { useTranslations } from "next-intl";
import { PALETTE, type PaletteKey } from "@/shared/kernel/style";
import { ChoiceGroup, paletteVars, VisuallyHidden } from "@/shared/ui";

/**
 * HU-E9-04: the 16 palette keys of HU-E3-05 as swatches, each named by its localized label (D22). Board Categorías 02
 * (P292): each is the saturated color on its tint, eight to a row at 390 px (44 px targets, no gap), with an optional
 * hint under them.
 */
export function ColorRow({
  value,
  onValueChange,
  hint,
}: {
  readonly value: PaletteKey;
  readonly onValueChange: (value: PaletteKey) => void;
  readonly hint?: string;
}) {
  const t = useTranslations("categories");
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-semibold text-ink">{t("colorLabel")}</legend>
      <div className="[&>[role=radiogroup]]:gap-0">
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
                  className="flex size-9 items-center justify-center rounded-full bg-[var(--tint)]"
                >
                  <span data-swatch className="size-6 rounded-full bg-[var(--ink)]" />
                </span>
                <VisuallyHidden>{t(`color.${key}`)}</VisuallyHidden>
              </>
            ),
          }))}
        />
      </div>
      {hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </fieldset>
  );
}
