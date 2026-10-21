import { useTranslations } from "next-intl";
import { formatDate, formatNumber, formatTime, type Formats } from "@/shared/ui/format/formatters";

/** HU-E9-13: fixed samples written by the app's own formatters, so the preview never drifts from the screens. */
export function FormatPreview({ formats }: { readonly formats: Formats }) {
  const t = useTranslations("settings");
  return (
    <div role="status" aria-live="polite" className="rounded-2xl bg-accent-soft p-4 text-ink">
      <p className="text-sm text-muted">{t("preview.label")}</p>
      <p className="mt-1 text-lg font-semibold">
        {formatNumber("1234567.89", formats)} · {formatDate("2026-10-16", formats)} ·{" "}
        {formatTime({ hour: 14, minute: 30 }, formats)}
      </p>
    </div>
  );
}
