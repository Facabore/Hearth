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
  const [Panel, setPanel] = useState<ComponentType<SheetProps> | undefined>(() => loaded);
  const { open } = props;
  useEffect(() => {
    if (open && !Panel) void preloadSheet().then(() => setPanel(() => loaded));
  }, [open, Panel]);
  return open && Panel ? <Panel {...props} /> : null;
}
