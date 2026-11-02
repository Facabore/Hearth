import { useId, type ReactNode } from "react";

/**
 * A figure with its caption and a fixed 224 px height, so the chunk arriving shifts nothing (ruling P220). The caption
 * names the figure explicitly with `aria-labelledby`: not every accessibility tree derives a figure's name from its
 * `figcaption`. Board E9-11 03 (ruling P272) draws it as a card, its caption for assistive technology only and a hint
 * on how to read a point under the chart.
 */
export function ChartFrame({
  caption,
  hint,
  children,
}: {
  readonly caption: string;
  readonly hint?: string;
  readonly children: ReactNode;
}) {
  const captionId = useId();
  return (
    <figure
      aria-labelledby={captionId}
      className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3.5"
    >
      <figcaption id={captionId} className="sr-only">
        {caption}
      </figcaption>
      <div className="h-56 w-full">{children}</div>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </figure>
  );
}
