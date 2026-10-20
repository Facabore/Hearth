import type { CSSProperties } from "react";
import type { PaletteKey } from "@/shared/kernel/style";

/** Ruling P135: a palette key's tokens as CSS variables; classes then use `bg-[var(--tint)] text-[var(--ink)]`. */
export const paletteVars = (key: PaletteKey): CSSProperties =>
  ({
    "--tint": `var(--pal-${key.toLowerCase()}-tint)`,
    "--ink": `var(--pal-${key.toLowerCase()}-ink)`,
  }) as CSSProperties;
