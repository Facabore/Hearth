"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent } from "react";
import { Button, ProblemNotice, Sheet, TextField } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import type { FriendDto } from "./friends";

/** Ruling P338: an apodo is trimmed and 1–40 characters long (`MAX_NICKNAME` in the spaces domain). */
const MAX_NICKNAME = 40;

/**
 * Ruling P338 (owner: "falta el botón de poner apodo"): the name the viewer gives a person of Amigos. For someone on
 * Hearth it is the viewer's own, nobody else sees it, and leaving it empty goes back to their name; for a guest it is
 * the guest's name, which cannot be empty. Saving reads Amigos again.
 */
export function NicknameSheet({
  open,
  onOpenChange,
  friend,
  api: injected,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly friend: FriendDto;
  readonly api?: Api;
}) {
  const t = useTranslations("friends.nickname");
  const router = useRouter();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const guest = friend.other.kind === "GUEST";
  const [value, setValue] = useState(guest ? friend.other.displayName : (friend.other.nickname ?? ""));
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, setPending] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setProblem(null);
    const trimmed = value.trim();
    try {
      const { error, response } = await api.PATCH("/api/v1/me/friends/{spaceId}", {
        params: { path: { spaceId: friend.spaceId } },
        body: { nickname: guest || trimmed !== "" ? trimmed : null },
      });
      if (response.ok) {
        onOpenChange(false);
        router.refresh();
        return;
      }
      setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("title", { name: friend.name })}>
      <form className="flex flex-col gap-4" onSubmit={(event) => void save(event)}>
        <TextField
          id="friend-nickname"
          label={t("label")}
          value={value}
          maxLength={MAX_NICKNAME}
          required={guest}
          autoComplete="off"
          hint={guest ? t("guestNote") : t("userNote", { name: friend.other.displayName })}
          onChange={(event) => setValue(event.target.value)}
        />
        {problem ? <ProblemNotice problem={problem} /> : null}
        <Button type="submit" size="lg" disabled={pending}>
          {t("save")}
        </Button>
      </form>
    </Sheet>
  );
}
