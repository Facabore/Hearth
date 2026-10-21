"use client";

import type { MouseEvent } from "react";
import { ChoiceGroup, paletteVars, Sheet, SymbolIcon } from "@/shared/ui";
import type { AccountDto } from "@/shared/ui/api/dto";
import { colorOf } from "./account-look";

/** HU-E9-03: the active accounts only, whatever is passed; a tap chooses and closes, even on the chosen one. */
export function AccountPicker({
  open,
  onOpenChange,
  accounts,
  value,
  onChoose,
  label,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly accounts: readonly AccountDto[];
  readonly value: string | null;
  readonly onChoose: (accountId: string) => void;
  readonly label: string;
}) {
  const live = accounts.filter((a) => a.archivedAt === null);
  const tapped = (event: MouseEvent) => {
    const id = (event.target as HTMLElement).closest("[role='radio']")?.getAttribute("value");
    if (!id) return;
    onChoose(id);
    onOpenChange(false);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={label}>
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
    </Sheet>
  );
}
