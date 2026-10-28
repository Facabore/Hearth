import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Icon } from "../atoms/icon";

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
 * the screen's header with its way back when the loaded screen has one (a title that waits on the data reads
 * "Cargando…" until then) and a neutral outline of the content in the row tokens, so nothing jumps when the screen
 * arrives. It is server markup only: the header draws `ScreenHeader`'s 48 px row with a plain link to the explicit
 * parent, because a client component here would ship its script to every route whose links prefetch the skeleton. The
 * link is marked `data-back`, so the app's navigation tracker sends a click on it back where the person was.
 */
export function LoadingScreen({
  header,
  shape = "list",
}: {
  readonly header?: { readonly backHref: string; readonly title?: string };
  readonly shape?: LoadingShape;
}) {
  const t = useTranslations("common");
  const label = t("loading");
  return (
    <section aria-busy="true" aria-label={label} className="flex flex-col gap-3 py-3">
      {header ? (
        <header className="flex min-h-12 items-center gap-2">
          <a
            href={header.backHref}
            data-back=""
            aria-label={t("back")}
            className="-ml-2 flex size-12 shrink-0 items-center justify-center rounded-full text-ink"
          >
            <Icon name="back" />
          </a>
          <h1 className="min-w-0 flex-1 text-[17px] leading-tight font-semibold [overflow-wrap:anywhere] text-ink">
            {header.title ?? label}
          </h1>
        </header>
      ) : null}
      <div aria-hidden="true" className="flex flex-col gap-(--space-2)">
        {PLACEHOLDERS[shape]()}
      </div>
    </section>
  );
}
