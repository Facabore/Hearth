"use client";

import { useTranslations } from "next-intl";

const ACTION = "flex h-14 w-full items-center justify-center rounded-[14px] px-6 text-base font-semibold";

/**
 * N2: a screen that failed. Reintentar runs `onRetry` (an error boundary's reset), or reloads the page when there is
 * none (the public layout renders this itself); "Ir al inicio" is the way out when retrying does not help. The
 * `connection` variant is for an API that did not answer. It renders a section: the boundary or layout owns `<main>`.
 *
 * Every route of a group loads its error boundary, so this stays lean on purpose (route script budgets, P134): plain
 * elements and an anchor, which also starts the home from a clean page rather than from the broken client state.
 */
export function ErrorScreen({
  digest,
  onRetry,
  variant = "unexpected",
}: {
  /** Next.js hides server error messages in production; the digest is the reference to quote (ruling P127). */
  readonly digest?: string | undefined;
  readonly onRetry?: () => void;
  readonly variant?: "unexpected" | "connection";
}) {
  const t = useTranslations("errorScreen");
  const errors = useTranslations("errors");
  const common = useTranslations("common");
  const connection = variant === "connection";
  return (
    <section className="flex flex-col gap-3 py-6">
      <h1 className="text-2xl font-semibold text-ink">{connection ? t("connectionTitle") : t("title")}</h1>
      {connection ? (
        <p className="text-muted">{t("connectionBody")}</p>
      ) : (
        <div role="alert" className="rounded-xl border border-danger p-3 text-sm text-danger">
          <p>{errors("Unknown")}</p>
          {digest ? <p className="text-muted">{errors("reference", { requestId: digest })}</p> : null}
        </div>
      )}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onRetry ?? (() => window.location.reload())}
          className={`${ACTION} bg-accent text-on-accent`}
        >
          {common("retry")}
        </button>
        <a href="/" className={`${ACTION} border border-line bg-surface text-ink`}>
          {common("toStart")}
        </a>
      </div>
    </section>
  );
}
