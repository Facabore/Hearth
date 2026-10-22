"use client";

import { useLayoutEffect } from "react";
import { applyStoredTheme } from "./theme";

/**
 * Mounted once in the root layout. The inline head script sets the theme before the first paint, but not on a page that
 * Next renders on the client after a `notFound()` thrown in a layout (a space the person cannot open): there the head
 * streams in and its script never runs, so the page stayed light in dark mode. Mounting applies the same choice.
 */
export function ThemeSync() {
  // A layout effect: the theme is set before the first paint of that page, so it never shows light for a frame.
  useLayoutEffect(() => applyStoredTheme(), []);
  return null;
}
