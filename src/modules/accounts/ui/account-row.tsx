import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { paletteVars, SymbolIcon } from "@/shared/ui";
import type { AccountDto } from "@/shared/ui/api/dto";
import { formatDate, formatMoney, type Formats } from "@/shared/ui/format/formatters";
import { colorOf } from "./account-look";
import { rateText } from "./account-sections";

/** HU-E9-03, the Accounts artboard's row: type icon and color, name, details and balance. */
export function AccountRow({
  account,
  formats,
  actions,
}: {
  readonly account: AccountDto;
  readonly formats: Formats;
  readonly actions?: ReactNode;
}) {
  const t = useTranslations("accounts");
  const color = colorOf(account);
  const { terms, derived } = account;
  const details: string[] = [];
  if (account.institution || account.lastFour)
    details.push(
      [account.institution, account.lastFour ? `···${account.lastFour}` : null].filter(Boolean).join(" "),
    );
  if (account.type === "CREDIT_CARD") {
    if (terms.creditLimit) details.push(t("card.limit", { amount: formatMoney(terms.creditLimit, formats) }));
    if (derived.availableCredit)
      details.push(t("card.available", { amount: formatMoney(derived.availableCredit, formats) }));
    if (derived.nextPaymentDate)
      details.push(t("card.payBy", { date: formatDate(derived.nextPaymentDate, formats) }));
  }
  if (account.type === "SAVINGS") {
    if (terms.annualRate) details.push(t("savings.rate", { rate: rateText(terms.annualRate, formats) }));
    if (terms.maturityDate)
      details.push(t("savings.maturity", { date: formatDate(terms.maturityDate, formats) }));
  }
  if (account.type === "LOAN") {
    if (terms.principal) details.push(t("loan.principal", { amount: formatMoney(terms.principal, formats) }));
    if (terms.termMonths !== null) details.push(t("loan.months", { months: String(terms.termMonths) }));
  }
  const negative = account.balance.amount.startsWith("-");
  return (
    <li aria-labelledby={`account-${account.id}`} className="flex min-h-16 items-center gap-3 py-2">
      <span
        data-icon={account.icon}
        data-color={color}
        style={paletteVars(color)}
        className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--tint)] text-[var(--ink)]"
      >
        <SymbolIcon name={account.icon} size={22} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span id={`account-${account.id}`} className="truncate font-medium text-ink">
          {account.name}
        </span>
        {details.length > 0 ? <span className="text-sm text-muted">{details.join(" · ")}</span> : null}
      </span>
      <span className="flex flex-col items-end">
        <span className={negative ? "font-semibold text-owe" : "font-semibold text-ink"}>
          {formatMoney(account.balance, formats)}
        </span>
        {account.includeInAvailable ? null : (
          <span className="text-xs text-muted">{t("outsideAvailable")}</span>
        )}
      </span>
      {actions}
    </li>
  );
}
