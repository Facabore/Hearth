"use client";

import { PALETTE, type PaletteKey } from "@/shared/kernel/style";
import { ChoiceGroup } from "./choice-group";
import { paletteVars } from "../palette";
import { VisuallyHidden } from "../atoms/visually-hidden";

/**
 * HU-E9-04: the 16 palette keys of HU-E3-05 as swatches, each named by its localized label (D22). Board Categorías 02
 * (P292): each is the saturated color on its tint, eight to a row at 390 px (44 px targets, no gap), with an optional
 * hint under them. Ruling P306: categories and spaces share it, so it lives in the shared UI.
 */
export function ColorRow({
  value,
  onValueChange,
  hint,
  label,
  colorName,
}: {
  readonly value: PaletteKey;
  readonly onValueChange: (value: PaletteKey) => void;
  readonly hint?: string;
  /**
   * Ruling P306: the legend and each swatch's name come from the screen that shows the row, from its own catalog area
   * (categories, or the settings area for a space's color), so the shared row reads no catalog of its own.
   */
  readonly label: string;
  readonly colorName: (key: PaletteKey) => string;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm font-semibold text-ink">{label}</legend>
      <div className="[&>[role=radiogroup]]:gap-0">
        <ChoiceGroup
          label={label}
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
                <VisuallyHidden>{colorName(key)}</VisuallyHidden>
              </>
            ),
          }))}
        />
      </div>
      {hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </fieldset>
  );
}
