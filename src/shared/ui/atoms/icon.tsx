import type { SymbolName } from "@/shared/kernel/style";
import { SYMBOL_PATHS } from "../icons/symbols";
import { UI_ICONS, type UiIconName } from "../icons/ui-icons";

interface StrokeProps {
  readonly path: string;
  readonly size: number;
  readonly className: string | undefined;
}

function Stroke({ path, size, className }: StrokeProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d={path} stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A decorative interface icon; the control around it carries the name. */
export function Icon({
  name,
  size = 24,
  className,
}: {
  name: UiIconName;
  size?: number;
  className?: string;
}) {
  return <Stroke path={UI_ICONS[name]} size={size} className={className} />;
}

/** A Hearth symbol (categories and accounts, ruling P122). */
export function SymbolIcon({
  name,
  size = 24,
  className,
}: {
  name: SymbolName;
  size?: number;
  className?: string;
}) {
  return <Stroke path={SYMBOL_PATHS[name]} size={size} className={className} />;
}
