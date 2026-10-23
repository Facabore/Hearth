"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { MouseEvent } from "react";
import { ChoiceGroup, Icon, paletteVars, Sheet, SymbolIcon } from "@/shared/ui";
import type { AccountDto } from "@/shared/ui/api/dto";
import { colorOf } from "./account-look";

/**
 * HU-E9-03: the active accounts only, whatever is passed; a tap chooses and closes, even on the chosen one. N7: given
 * `newAccountHref` (already carrying a `returnTo` back to the form), the list ends with a New account link, and an
 * empty list says so and offers the same action.
 */
export function AccountPicker({
  open,
  onOpenChange,
  accounts,
  value,
  onChoose,
  label,
  newAccountHref,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly accounts: readonly AccountDto[];
  readonly value: string | null;
  readonly onChoose: (accountId: string) => void;
  readonly label: string;
  readonly newAccountHref?: string;
}) {
  const t = useTranslations("accounts");
  const live = accounts.filter((a) => a.archivedAt === null);
  const tapped = (event: MouseEvent) => {
    const id = (event.target as HTMLElement).closest("[role='radio']")?.getAttribute("value");
    if (!id) return;
    onChoose(id);
    onOpenChange(false);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={label}>
      {live.length === 0 ? (
        <p className="mb-2 rounded-2xl bg-track p-3 text-sm text-ink">{t("picker.empty")}</p>
      ) : (
        <div onClick={tapped}>
          <ChoiceGroup
            label={label}
            layout="chips"
            value={value ?? ""}
            onValueChange={() => undefined}
            options={live.map((a) => ({
              value: a.id,
              label: (
                <span className="flex items-center gap-2 py-1 text-left">
                  <span
                    aria-hidden="true"
                    style={paletteVars(colorOf(a))}
                    className="flex size-8 items-center justify-center rounded-lg bg-[var(--tint)] text-[var(--ink)]"
                  >
                    <SymbolIcon name={a.icon} size={18} />
                  </span>
                  <span className="flex flex-col">
                    <span>{a.name}</span>
                    {a.institution ? <span className="text-xs text-muted">{a.institution}</span> : null}
                  </span>
                </span>
              ),
            }))}
          />
        </div>
      )}
      {newAccountHref ? (
        <Link
          href={newAccountHref}
          onClick={() => onOpenChange(false)}
          className="mt-2 flex min-h-14 items-center gap-3 rounded-xl px-2 font-medium text-accent"
        >
          <Icon name="plus" />
          {t("new")}
        </Link>
      ) : null}
    </Sheet>
  );
}
