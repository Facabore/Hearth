import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ScreenHeader } from "./screen-header";

/** The rough outline of the screen being loaded: a list of rows, a form of fields, or the cards of a summary. */
export type LoadingShape = "list" | "form" | "cards";

const bar = "rounded-xl bg-line motion-safe:animate-pulse";

const PLACEHOLDERS: Record<LoadingShape, () => ReactNode> = {
  list: () => Array.from({ length: 6 }, (_, i) => <div key={i} className={`h-(--row-lg) ${bar}`} />),
  form: () => (
    <>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex flex-col gap-(--space-2)">
          <div className={`h-(--space-4) w-24 ${bar}`} />
          <div className={`h-(--row) ${bar}`} />
        </div>
      ))}
      <div className={`h-(--row-lg) ${bar}`} />
    </>
  ),
  cards: () => (
    <>
      <div className={`h-32 rounded-2xl ${bar}`} />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className={`h-(--row-lg) ${bar}`} />
      ))}
    </>
  ),
};

/**
 * Issue #196: what a route shows the moment it is tapped, while its server renders. A busy region named "Cargando…",
 * the screen's own header with its way back when the loaded screen has one (a title that waits on the data reads
 * "Cargando…" until then) and a neutral outline of the content in the row tokens, so nothing jumps when the screen
 * arrives. It renders on the server and adds no script: the header is the one the loaded screen already ships.
 */
export function LoadingScreen({
  header,
  shape = "list",
}: {
  readonly header?: { readonly backHref: string; readonly title?: string };
  readonly shape?: LoadingShape;
}) {
  const label = useTranslations("common")("loading");
  return (
    <section aria-busy="true" aria-label={label} className="flex flex-col gap-3 py-3">
      {header ? <ScreenHeader backHref={header.backHref} title={header.title ?? label} /> : null}
      <div aria-hidden="true" className="flex flex-col gap-(--space-2)">
        {PLACEHOLDERS[shape]()}
      </div>
    </section>
  );
}
