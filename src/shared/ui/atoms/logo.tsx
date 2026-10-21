import { useTranslations } from "next-intl";

/** The Main artboard's mark (a house holding a flame) and the product name. */
export function Logo() {
  const t = useTranslations("common");
  return (
    <span className="inline-flex items-center gap-2 text-lg font-semibold text-ink">
      <svg width={28} height={28} viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <path
          d="M5 13 14 5.5 23 13v10H5V13Z"
          stroke="var(--accent)"
          strokeWidth={1.75}
          strokeLinejoin="round"
        />
        <path
          d="M14 21c-2.2 0-3.6-1.6-3.6-3.6 0-2.6 3.6-5 3.6-6.6 0 1.6 3.6 4 3.6 6.6 0 2-1.4 3.6-3.6 3.6Z"
          stroke="var(--owe)"
          strokeWidth={1.75}
          strokeLinejoin="round"
        />
      </svg>
      {t("appName")}
    </span>
  );
}
