import { lazy, Suspense } from "react";
import type { Viewer } from "../load";

// Ruling P300: the screens load in their own chunk. This frame is a chunk apart from the record form's because it holds
// the list of files that chunk needs, which would otherwise weigh on the form's own script (ADR 0004).
const Screen = lazy(() =>
  import("../routes/record-backdrop").then((module) => ({ default: module.RecordBackdrop })),
);

/**
 * Ruling P300 (#240, board B1 · 01): the frame under the record sheet's scrim that draws the screen it was opened from.
 * It is inert and hidden from assistive technology, so the form keeps its focus, Escape, scrim and keypad as they were,
 * and fixed as the stacked shell lays a screen out, so the page under the sheet never scrolls.
 */
export function RecordBehind({
  viewer,
  returnTo,
}: {
  readonly viewer: Viewer;
  readonly returnTo: string | undefined;
}) {
  return (
    <div
      data-testid="record-backdrop"
      inert
      aria-hidden="true"
      className="fixed inset-0 mx-auto max-w-[1200px] overflow-hidden px-gutter"
    >
      <Suspense fallback={null}>
        <Screen viewer={viewer} returnTo={returnTo} />
      </Suspense>
    </div>
  );
}
