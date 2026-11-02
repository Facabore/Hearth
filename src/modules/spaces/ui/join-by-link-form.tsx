"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button, TextField } from "@/shared/ui";

/**
 * The app path a pasted Hearth link opens: an invitation (`/invitations/{token}`) or a guest's claim link
 * (`/claims/{token}`), whatever host it was copied with; anything else names none.
 */
export const joinPathOf = (text: string): string | null => {
  let path: string;
  try {
    path = new URL(text.trim(), "https://hearth.invalid").pathname;
  } catch {
    return null;
  }
  const match = /^\/(invitations|claims)\/([A-Za-z0-9_-]+)\/?$/.exec(path);
  return match ? `/${match[1]}/${match[2]}` : null;
};

/**
 * HU-E9-05, the board "Unirme con un enlace de invitación": someone who got a link outside the phone's chat pastes it
 * here and sees the invitation, which is where joining happens. `onOpened` closes the sheet around the form.
 */
export function JoinByLinkForm({ onOpened }: { readonly onOpened: () => void }) {
  const t = useTranslations("spaces.join");
  const router = useRouter();
  const [link, setLink] = useState("");
  const [invalid, setInvalid] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const path = joinPathOf(link);
    if (!path) {
      setInvalid(true);
      return;
    }
    onOpened();
    router.push(path);
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <TextField
        id="join-link"
        inputMode="url"
        autoComplete="off"
        label={t("link")}
        hint={t("hint")}
        value={link}
        error={invalid ? t("invalid") : undefined}
        onChange={(event) => {
          setLink(event.target.value);
          setInvalid(false);
        }}
      />
      <Button type="submit" size="lg">
        {t("submit")}
      </Button>
    </form>
  );
}
