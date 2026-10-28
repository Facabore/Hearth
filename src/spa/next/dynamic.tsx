import { lazy, Suspense, type ComponentType } from "react";

type Loaded<P> = ComponentType<P> | { readonly default: ComponentType<P> };

/**
 * Next.js's `dynamic`: the component's code loads when it first renders, with `loading` meanwhile (ADR 0006). React
 * keeps a failed lazy load for good, so a failure (a flaky network, a chunk gone after a release) starts a fresh lazy
 * component that the next render, such as Reintentar's, loads again.
 */
export default function dynamic<P extends object>(
  loader: () => Promise<Loaded<P>>,
  options: { readonly ssr?: boolean; readonly loading?: ComponentType } = {},
): ComponentType<P> {
  const fresh = (): ComponentType<P> =>
    lazy(async () => {
      try {
        const loaded = await loader();
        return { default: "default" in loaded ? loaded.default : loaded };
      } catch (error) {
        current = fresh();
        throw error;
      }
    });
  let current = fresh();
  const Loading = options.loading;
  return function Dynamic(props: P) {
    const Lazy = current;
    return (
      <Suspense fallback={Loading ? <Loading /> : null}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}
