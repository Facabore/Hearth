"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button } from "../atoms/button";
import { Icon } from "../atoms/icon";
import { TextField } from "../atoms/text-field";

/**
 * Ruling P181: a URL shown once (only its token's hash is stored), read-only so it can still be selected by hand, and a
 * Copy button. The outcome is announced; when the clipboard refuses, the text is selected and the person copies it.
 */
export function CopyField({
  id,
  label,
  value,
  note,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly note?: string;
}) {
  const t = useTranslations("common");
  const field = useRef<HTMLInputElement>(null);
  const [outcome, setOutcome] = useState<"copied" | "copyFailed" | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setOutcome("copied");
    } catch {
      field.current?.select();
      setOutcome("copyFailed");
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <TextField
        ref={field}
        id={id}
        label={label}
        value={value}
        readOnly
        hint={note}
        onFocus={(event) => event.currentTarget.select()}
        trailing={
          <Button size="icon" variant="ghost" aria-label={t("copy")} onClick={() => void copy()}>
            <Icon name="copy" />
          </Button>
        }
      />
      <p role="status" className="text-sm text-muted">
        {outcome ? t(outcome) : null}
      </p>
    </div>
  );
}
