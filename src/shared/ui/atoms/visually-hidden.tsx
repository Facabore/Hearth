import type { ReactNode } from "react";

/** Text for assistive technology only (Tailwind's `sr-only`): the name of an icon-only control. */
export function VisuallyHidden({ children }: { readonly children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
