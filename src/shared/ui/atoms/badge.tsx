import type { ReactNode } from "react";
import { cn } from "../cn";
import type { UiIconName } from "../icons/ui-icons";
import { Icon } from "./icon";

const TONES = {
  neutral: "bg-track text-muted",
  accent: "bg-accent-soft text-accent",
  owe: "bg-owe-soft text-owe",
} as const;

export function Badge({
  tone = "neutral",
  icon,
  children,
}: {
  readonly tone?: keyof typeof TONES;
  readonly icon?: UiIconName;
  readonly children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONES[tone],
      )}
    >
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </span>
  );
}
