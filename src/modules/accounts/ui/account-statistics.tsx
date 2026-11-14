import { useTranslations } from "next-intl";
import { CategoryIcon } from "@/modules/categories/ui";
import { paletteVars, SymbolIcon } from "@/shared/ui";
import type { CategoryGroupDto, MoneyDto } from "@/shared/ui/api/dto";
import { formatMoney, formatPercent, type Formats } from "@/shared/ui/format/formatters";

/** Ruling P327: one group of what an account paid, as its breakdown answers it (largest first). */
export interface PaidGroup {
  /** Null for a personal row merged by catalog key (P76). */
  readonly id: string | null;
  readonly key: string | null;
  readonly name: string;
  readonly total: MoneyDto;
  /** Percent of the account's total with two decimals ("86.96"). */
  readonly share: string;
  readonly movements?: number | undefined;
  readonly categories: readonly { readonly name: string }[];
}

/** "86.96" → "87": the board reads a whole percent, rounded half up. */
export const wholePercent = (share: string): string => {
  const [whole = "0", fraction = ""] = share.split(".");
  return ((fraction[0] ?? "0") >= "5" ? BigInt(whole) + 1n : BigInt(whole)).toString();
};

/** The group's own icon and color: its id in the space's tree, else its catalog key (a merged personal row). */
const lookOf = (group: PaidGroup, groups: readonly CategoryGroupDto[]) =>
  groups.find((g) => g.id === group.id) ??
  (group.key === null ? undefined : groups.find((g) => g.key === group.key));

/**
 * Ruling P327 (board "Cuenta · Estadísticas · #315"): what the account paid for expenses in the period, one row per
 * group, largest first: its name, "87 % · Arriendo · 1 movimiento", the amount and a bar of its share. Transfers
 * between the person's own accounts are not spending (D21), and the screen says so.
 */
export function AccountStatistics({
  groups,
  looks,
  formats,
}: {
  readonly groups: readonly PaidGroup[];
  /** The categories of the account's space, whose groups lend each row its icon and color. */
  readonly looks: readonly CategoryGroupDto[];
  readonly formats: Formats;
}) {
  const t = useTranslations("accounts.screen");
  return (
    <>
      {groups.length === 0 ? (
        <p className="text-muted">{t("nothingPaid")}</p>
      ) : (
        <ul aria-label={t("byGroup")} className="flex flex-col divide-y divide-line">
          {groups.map((group) => {
            const look = lookOf(group, looks);
            const percent = formatPercent(wholePercent(group.share), formats);
            const detail = [
              percent,
              group.categories.map((c) => c.name).join(", "),
              group.movements === undefined ? null : t("movementCount", { count: group.movements }),
            ].filter((part): part is string => Boolean(part));
            return (
              <li key={group.id ?? `key/${group.key}`} className="flex flex-col gap-2 py-2">
                <span className="flex min-h-11 items-center gap-3">
                  <span className="shrink-0 overflow-hidden rounded-full">
                    {look ? (
                      <CategoryIcon icon={look.icon} color={look.color} size={36} />
                    ) : (
                      <span
                        aria-hidden="true"
                        style={paletteVars("GRAPHITE")}
                        className="flex size-9 items-center justify-center bg-[var(--tint)] text-[var(--ink)]"
                      >
                        <SymbolIcon name="dots" size={20} />
                      </span>
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-base font-medium [overflow-wrap:anywhere] text-ink">
                      {group.name}
                    </span>
                    <span className="text-[13px] break-words text-muted">{detail.join(" · ")}</span>
                  </span>
                  <span className="shrink-0 text-base font-semibold whitespace-nowrap text-ink">
                    {formatMoney(group.total, formats)}
                  </span>
                </span>
                <span aria-hidden="true" className="block h-1.5 w-full overflow-hidden rounded-full bg-track">
                  <span
                    data-bar
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${Number(group.share)}%` }}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t border-line pt-3 text-sm text-muted">{t("transfersNote")}</p>
    </>
  );
}
