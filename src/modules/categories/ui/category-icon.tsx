import { SYMBOLS, type PaletteKey, type SymbolName } from "@/shared/kernel/style";
import { paletteVars, SymbolIcon } from "@/shared/ui";
import type { CategoryDto } from "@/shared/ui/api/dto";

const isSymbol = (name: string): name is SymbolName => (SYMBOLS as readonly string[]).includes(name);

/** A category's symbol or emoji on its palette tint (D22, ruling P122); decorative, the name is written next to it. */
export function CategoryIcon({
  icon,
  color,
  size = 36,
}: {
  readonly icon: CategoryDto["icon"];
  readonly color: PaletteKey;
  readonly size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      style={{ ...paletteVars(color), width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center rounded-xl bg-[var(--tint)] text-[var(--ink)]"
    >
      {icon.kind === "EMOJI" ? (
        <span className="text-lg leading-none">{icon.value}</span>
      ) : (
        <SymbolIcon name={isSymbol(icon.name) ? icon.name : "dots"} size={Math.round(size * 0.6)} />
      )}
    </span>
  );
}
