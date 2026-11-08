import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon, usePeriodText } from "@/shared/ui";
import type { PeriodDto, SpaceDto } from "@/shared/ui/api/dto";
import type { Formats } from "@/shared/ui/format/formatters";

const step =
  "flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink disabled:opacity-35";

/** One step: a link while there is a period that way, else a disabled button in its place. */
function Step({
  href,
  label,
  back,
}: {
  readonly href?: string | undefined;
  readonly label: string;
  readonly back?: boolean;
}) {
  const icon = <Icon name="chevronRight" size={20} className={back ? "rotate-180" : undefined} />;
  return href ? (
    <Link href={href} aria-label={label} className={step}>
      {icon}
    </Link>
  ) : (
    <button type="button" disabled aria-label={label} className={step}>
      {icon}
    </button>
  );
}

/**
 * Ruling P310 (board "Inicio personal · cambiar de mes y abrir cada parte · P310"): the personal Inicio's period, with
 * a step back and a step forward, each 44 × 44 px. There is no step past the current period: it shows, disabled.
 */
export function PeriodStepper({
  period,
  policy,
  formats,
  previousHref,
  nextHref,
}: {
  /** The period shown: "octubre 2026", or its dates. */
  readonly period: PeriodDto;
  readonly policy: SpaceDto["periodPolicy"];
  readonly formats: Pick<Formats, "dateFormat">;
  /** The period before, while it is known. */
  readonly previousHref?: string | undefined;
  /** The period after; none on the current period. */
  readonly nextHref?: string | undefined;
}) {
  const t = useTranslations("home.period");
  const label = usePeriodText()(period, policy, formats);
  return (
    <div className="flex items-center justify-between gap-2">
      <Step href={previousHref} label={t("previous")} back />
      {/* A flex item: its first letter is styled in a box of its own, as Movimientos' period chip does. */}
      <p className="inline-block text-center font-semibold first-letter:uppercase text-ink">{label}</p>
      <Step href={nextHref} label={t("next")} />
    </div>
  );
}
