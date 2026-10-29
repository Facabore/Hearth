import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { Button, Icon } from "@/shared/ui";
import { formatMoney, formatPercent, type Formats } from "@/shared/ui/format/formatters";
import type { LineWarning } from "./line-watch";

interface NoteProps {
  readonly warning: LineWarning;
  readonly formats: Formats;
}

/** #142 (ruling P235 of M6c): the state an expense would leave its line in; NEAR is neutral, HIGH and OVER owe. */
export function LineWarningNote({ warning, formats }: NoteProps) {
  const t = useTranslations("ledger.lineWarning");
  const values = {
    line: warning.line,
    used: warning.used === null ? "" : formatPercent(warning.used, formats),
    rest: formatMoney(warning.rest, formats),
  };
  return (
    <div
      id="record-line-warning"
      data-level={warning.level}
      className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${
        warning.level === "NEAR" ? "bg-track text-muted" : "bg-owe-soft text-owe-ink"
      }`}
    >
      <Icon name="alert" size={20} className="shrink-0" />
      <p>{t(warning.level === "NEAR" ? "near" : warning.level === "HIGH" ? "high" : "over", values)}</p>
    </div>
  );
}

/**
 * Ruling P235, amended by #211: an expense over its line asks once before saving; the person can still save, or go back
 * to the amount. Its buttons come into view above the bottom bar, which would otherwise cover them on a phone.
 */
export function LineWarningConfirm({
  warning,
  formats,
  onConfirm,
  onReview,
}: NoteProps & { readonly onConfirm: () => void; readonly onReview: () => void }) {
  const t = useTranslations("ledger.lineWarning");
  const title = useRef<HTMLHeadingElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  useEffect(() => {
    title.current?.focus();
    actions.current?.scrollIntoView?.({ block: "nearest" });
  }, []);
  return (
    <section aria-labelledby="record-line-confirm" className="flex flex-col gap-3">
      <h2 id="record-line-confirm" ref={title} tabIndex={-1} className="text-lg font-semibold text-ink">
        {t("confirmTitle")}
      </h2>
      <LineWarningNote warning={warning} formats={formats} />
      {/* The scroll margin is the bottom bar (76 px, nav-links.tsx) plus 12 px, so nearest scrolling leaves them above it. */}
      <div ref={actions} className="flex scroll-mb-[calc(88px+env(safe-area-inset-bottom))] flex-wrap gap-3">
        <Button size="lg" onClick={onConfirm}>
          {t("confirm")}
        </Button>
        <Button variant="secondary" size="lg" onClick={onReview}>
          {t("review")}
        </Button>
      </div>
    </section>
  );
}
