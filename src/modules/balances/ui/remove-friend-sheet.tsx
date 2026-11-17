"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button, ProblemNotice, Sheet } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import type { FriendDto } from "./friends";

/**
 * Ruling P339 (board "Amigos · solicitudes y eliminar", S7): removing a person from Amigos, only once the two are even.
 * Al día, it says what removing does and "Eliminar de Amigos" archives the pair's direct space, which leaves Amigos for
 * both while every movement stays in each one's history, then goes back to Amigos. With a balance (known here, or the
 * API's `FriendHasBalance`), it says "Con saldo pendiente, primero se salda." and offers Saldar instead.
 */
export function RemoveFriendSheet({
  open,
  onOpenChange,
  friend,
  even,
  personalSpaceId,
  onSettle,
  api: injected,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly friend: FriendDto;
  /** Whether the two are even, as the screen knows it; the API decides. */
  readonly even: boolean;
  readonly personalSpaceId: string;
  /** Saldar's sheet, when the viewer may settle in their direct space. */
  readonly onSettle?: () => void;
  readonly api?: Api;
}) {
  const t = useTranslations("friends.remove");
  const router = useRouter();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [owing, setOwing] = useState(!even);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, setPending] = useState(false);
  const name = friend.name;

  const remove = async () => {
    setPending(true);
    setProblem(null);
    try {
      const { error, response } = await api.DELETE("/api/v1/me/friends/{spaceId}", {
        params: { path: { spaceId: friend.spaceId } },
      });
      if (response.ok) {
        onOpenChange(false);
        router.replace(`/spaces/${personalSpaceId}/balances`);
        return;
      }
      const refused = problemFrom(error, response);
      if (refused.code === "FriendHasBalance") setOwing(true);
      else setProblem(refused);
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("title", { name })}>
      <div className="flex flex-col gap-3">
        {owing ? (
          <>
            <p role="status" className="text-[15px] text-ink">
              {t("pending")}
            </p>
            {onSettle ? (
              <Button
                size="lg"
                onClick={() => {
                  onOpenChange(false);
                  onSettle();
                }}
              >
                {t("settle")}
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-[15px] text-ink">{t("even", { name })}</p>
            {problem ? <ProblemNotice problem={problem} /> : null}
            <Button variant="danger" size="lg" disabled={pending} onClick={() => void remove()}>
              {t("confirm")}
            </Button>
          </>
        )}
        <Button variant="ghost" size="lg" onClick={() => onOpenChange(false)}>
          {t("cancel")}
        </Button>
        {owing ? null : <p className="text-sm text-muted">{t("pending")}</p>}
      </div>
    </Sheet>
  );
}
