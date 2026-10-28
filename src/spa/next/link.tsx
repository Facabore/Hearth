import { useRouter } from "@tanstack/react-router";
import type { AnchorHTMLAttributes, MouseEvent, Ref } from "react";

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  readonly href: string;
  readonly replace?: boolean;
  readonly scroll?: boolean;
  readonly prefetch?: boolean | null;
  readonly ref?: Ref<HTMLAnchorElement>;
};

const modified = (event: MouseEvent) => event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

/**
 * Next.js's `Link` over TanStack Router (ADR 0006): a plain anchor whose `href` carries the app's base, a client
 * navigation on a plain click, and the target's code and data loaded on intent (hover, focus or touch), never ahead.
 */
// `scroll` stays off the anchor: TanStack Router scrolls a new screen to the top by itself.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function Link({ href, replace, scroll, prefetch, onClick, ref, ...rest }: LinkProps) {
  const router = useRouter();
  const preload = () => {
    if (prefetch !== false) void router.preloadRoute({ href } as never).catch(() => undefined);
  };
  return (
    <a
      {...rest}
      ref={ref}
      href={router.buildLocation({ href } as never).publicHref}
      onMouseEnter={preload}
      onFocus={preload}
      onTouchStart={preload}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || modified(event) || rest.target) return;
        event.preventDefault();
        void router.navigate({ href, replace });
      }}
    />
  );
}
