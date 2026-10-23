import { useId, type ReactNode } from "react";

/**
 * A figure with its caption and a fixed 224 px height, so the chunk arriving shifts nothing (ruling P220). The caption
 * names the figure explicitly with `aria-labelledby`: not every accessibility tree derives a figure's name from its
 * `figcaption`.
 */
export function ChartFrame({ caption, children }: { caption: string; children: ReactNode }) {
  const captionId = useId();
  return (
    <figure aria-labelledby={captionId} className="flex flex-col gap-2">
      <figcaption id={captionId} className="text-sm font-medium text-ink">
        {caption}
      </figcaption>
      <div className="h-56 w-full">{children}</div>
    </figure>
  );
}
