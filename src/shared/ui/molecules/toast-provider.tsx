import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

/**
 * Ruling P195: the live regions every toast speaks in, rendered on the server so they exist before any message (WCAG
 * 4.1.3) and cost no script. The toast itself mounts into them from `toast-host` when something is saved. They sit
 * above the bottom navigation and the safe area and under the sheets (z-50), and never take a pointer.
 */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const t = useTranslations("toast");
  return (
    <>
      {children}
      <section
        aria-label={t("region")}
        data-toast-region=""
        data-dismiss={t("dismiss")}
        className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom)+0.5rem)] z-40 flex flex-col items-center px-4 lg:bottom-4 lg:pl-[256px]"
      >
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-toast="status"
          className="w-full max-w-[480px]"
        />
        <div
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          data-toast="alert"
          className="w-full max-w-[480px]"
        />
      </section>
    </>
  );
}
