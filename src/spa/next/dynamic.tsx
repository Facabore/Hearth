import { lazy, Suspense, type ComponentType } from "react";

type Loaded<P> = ComponentType<P> | { readonly default: ComponentType<P> };

/** Next.js's `dynamic`: the component's code loads when it first renders, with `loading` meanwhile (ADR 0006). */
export default function dynamic<P extends object>(
  loader: () => Promise<Loaded<P>>,
  options: { readonly ssr?: boolean; readonly loading?: ComponentType } = {},
): ComponentType<P> {
  const Lazy = lazy(async () => {
    const loaded = await loader();
    return { default: "default" in loaded ? loaded.default : loaded };
  });
  const Loading = options.loading;
  return function Dynamic(props: P) {
    return (
      <Suspense fallback={Loading ? <Loading /> : null}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}
