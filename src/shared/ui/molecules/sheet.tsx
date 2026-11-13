"use client";

import { useEffect, useState, type ComponentType } from "react";
import type { SheetProps } from "./sheet-panel";

export type { SheetProps };

let loaded: ComponentType<SheetProps> | undefined;
let loading: Promise<void> | undefined;

/**
 * Loads the panel once. It holds the Radix Dialog code (about 25 KiB compressed), which no screen needs until a sheet
 * opens (ruling P134); the ui test setup awaits it so a sheet opens synchronously there.
 */
export const preloadSheet = (): Promise<void> =>
  (loading ??= import("./sheet-panel").then((module) => {
    loaded = module.SheetPanel;
  }));

/** A bottom sheet under 1024 px, a centered panel above; Escape and the scrim close it, focus returns to the trigger. */
export function Sheet(props: SheetProps) {
  const [state, setPanel] = useState<ComponentType<SheetProps> | undefined>(() => loaded);
  // #314: a sheet mounted before the panel loaded takes the panel as soon as any sheet loaded it, so a sheet that
  // replaces another opens in the same render instead of one later.
  const Panel = state ?? loaded;
  const { open } = props;
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  useEffect(() => {
    if (open && !Panel) void preloadSheet().then(() => setPanel(() => loaded));
  }, [open, Panel]);
  // Ruling P325: once shown, the panel stays mounted, so Radix plays its closing movement before it goes.
  return shown && Panel ? <Panel {...props} /> : null;
}
