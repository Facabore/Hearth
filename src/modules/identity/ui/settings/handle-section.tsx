"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { TextField } from "@/shared/ui";
import type { Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { SavedFlash } from "@/shared/ui/molecules/saved-flash";

/**
 * Ruling P339 (S2): the person's @usuario, by which others find them in Agregar amigo, only by its exact spelling. As the
 * rest of the screen (ruling P137) it has no Save button: what is typed is stored when the field is left or Enter is
 * pressed, and an empty field clears it. The API reads it trimmed, without its "@" and in lower case, and answers
 * `InvalidHandle` or `HandleTaken`, said under the field until the person types again.
 */
export function HandleSection({
  handle,
  onCommit,
  problem,
  saved = false,
}: {
  /** The stored @, without the "@"; absent while the person has none. */
  readonly handle?: string;
  /** Stores what was typed: null clears the @. */
  readonly onCommit: (handle: string | null) => void;
  readonly problem: Problem | null;
  /** U5: the @ was just stored. */
  readonly saved?: boolean;
}) {
  const t = useTranslations("settings.handle");
  const messageOf = useProblemMessage();
  const [typed, setTyped] = useState(handle ?? "");
  const [hidden, setHidden] = useState(false);
  const [seen, setSeen] = useState({ handle, problem });
  // A new refusal shows until the person types again; the stored @ (as the API wrote it) replaces what was typed.
  if (seen.handle !== handle || seen.problem !== problem) {
    setSeen({ handle, problem });
    setHidden(false);
    if (seen.handle !== handle) setTyped(handle ?? "");
  }
  const shown = hidden ? null : problem;

  const commit = () => {
    const value = typed.trim().replace(/^@/, "");
    if (value === (handle ?? "")) return;
    onCommit(value === "" ? null : value);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    commit();
  };

  return (
    <form className="relative flex flex-col gap-1" onSubmit={submit} noValidate>
      <SavedFlash show={saved} className="-top-5" />
      <TextField
        id="settings-handle"
        label={t("label")}
        leading="@"
        value={typed}
        maxLength={64}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        hint={t("hint")}
        error={shown ? messageOf(shown).message : undefined}
        onChange={(event) => {
          setTyped(event.target.value);
          setHidden(true);
        }}
        onBlur={commit}
      />
    </form>
  );
}
