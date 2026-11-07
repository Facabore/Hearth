import type { PaletteKey } from "@/shared/kernel/style";
import { paletteVars } from "../palette";

/**
 * Ruling P306 (boards "Inicio personal · todo en un lugar"): a space's name on its color, the tag of its rows in the
 * personal feed. The name always carries it, so the color is never the only cue (AGENTS.md); a long name wraps.
 */
export function SpaceChip({ name, color }: { readonly name: string; readonly color: PaletteKey }) {
  return (
    <span
      data-space-chip
      style={paletteVars(color)}
      className="inline-flex max-w-full items-center rounded-full bg-[var(--tint)] px-2 py-0.5 text-xs font-semibold [overflow-wrap:anywhere] text-[var(--ink)]"
    >
      {name}
    </span>
  );
}
