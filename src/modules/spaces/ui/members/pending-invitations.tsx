"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { localDateIn } from "@/shared/kernel/time-zone";
import { Button, ProblemNotice } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { InvitationDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { formatDate, formatNumber, type Formats } from "@/shared/ui/format/formatters";
import { useToast } from "@/shared/ui/molecules/toast";
import { TOAST_ACTION_MS } from "@/shared/ui/molecules/toast-timing";

/**
 * HU-E9-05, ruling P155, the Main artboard's "Invitaciones pendientes": the invitations that can still be accepted,
 * each with Revoke. Never Copy: only the token's hash is stored, so a URL cannot be shown again. #218, ruling P264: a
 * link says whether it serves one person (ADMIN) or several, and next to Revoke how many people joined through it; a
 * link with no recorded use (or from before #218, without the count) shows no count.
 *
 * The board "Invitación revocada con deshacer" (ruling P272): Revoke hides the invitation at once and the toast offers
 * Deshacer. The API has no way back from a revoke, so the revoke is sent when the toast's time is up, or at once when
 * the screen closes or the page is hidden; Deshacer before that keeps the invitation as it was.
 */
export function PendingInvitations({
  spaceId,
  invitations,
  formats,
  viewerZone,
  api: injected,
}: {
  readonly spaceId: string;
  readonly invitations: readonly InvitationDto[];
  readonly formats: Formats;
  readonly viewerZone: string;
  readonly api?: Api;
}) {
  const t = useTranslations("members");
  const roles = useTranslations("shell.role");
  const router = useRouter();
  const toast = useToast();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [problem, setProblem] = useState<Problem | null>(null);
  const waiting = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const show = (invitationId: string) =>
    setHidden((current) => new Set([...current].filter((id) => id !== invitationId)));

  const send = async (invitationId: string, keepalive = false) => {
    try {
      const { error, response } = await api.POST(
        "/api/v1/spaces/{spaceId}/invitations/{invitationId}/revoke",
        { params: { path: { spaceId, invitationId } }, ...(keepalive ? { keepalive } : {}) },
      );
      if (response.ok) {
        router.refresh();
        return;
      }
      setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    show(invitationId);
  };
  // The latest `send` for the timers and the flush, which outlive the render that started them.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });

  useEffect(() => {
    const timers = waiting.current;
    const flush = () => {
      for (const [invitationId, timer] of timers) {
        clearTimeout(timer);
        void sendRef.current(invitationId, true);
      }
      timers.clear();
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      flush();
    };
  }, []);

  const undo = (invitationId: string) => {
    const timer = waiting.current.get(invitationId);
    if (timer === undefined) {
      toast.show({ tone: "alert", message: t("undoLate") });
      return;
    }
    clearTimeout(timer);
    waiting.current.delete(invitationId);
    show(invitationId);
  };

  const revoke = (invitationId: string) => {
    if (waiting.current.has(invitationId)) return;
    setProblem(null);
    setHidden((current) => new Set([...current, invitationId]));
    waiting.current.set(
      invitationId,
      setTimeout(() => {
        waiting.current.delete(invitationId);
        void sendRef.current(invitationId);
      }, TOAST_ACTION_MS),
    );
    toast.show({ message: t("revoked"), action: { label: t("undo"), onAction: () => undo(invitationId) } });
  };

  const visible = invitations.filter((invitation) => !hidden.has(invitation.id));
  if (visible.length === 0 && !problem) return null;

  return (
    <section aria-labelledby="members-pending" className="flex flex-col gap-1.5">
      <h2 id="members-pending" className="text-sm font-semibold text-muted">
        {t("pending")}
      </h2>
      {problem ? <ProblemNotice problem={problem} /> : null}
      {visible.length > 0 ? (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface px-3">
          {visible.map((invitation) => {
            const role = roles(invitation.role);
            const date = formatDate(localDateIn(new Date(invitation.expiresAt), viewerZone), formats);
            const email = invitation.email;
            const uses = invitation.uses ?? 0;
            const linkDetail = invitation.singleUse ? "pendingLinkSingle" : "pendingLink";
            return (
              <li key={invitation.id} className="flex min-h-row-lg items-center gap-3 py-1.5">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium text-ink">{email ?? t("pendingLinkTitle")}</span>
                  <span className="text-sm text-muted">
                    {email ? t("pendingEmail", { role, date }) : t(linkDetail, { role, date })}
                  </span>
                </span>
                {/* Stacked with Revoke, so the row keeps its room for the role and expiry at 320 px. */}
                <span className="flex shrink-0 flex-col items-end">
                  {!email && uses > 0 ? (
                    <span className="text-xs text-muted">
                      {t("pendingUses", { count: uses, people: formatNumber(String(uses), formats) })}
                    </span>
                  ) : null}
                  <Button
                    variant="dangerGhost"
                    aria-label={email ? t("revokeEmail", { email }) : t("revokeLink", { role })}
                    onClick={() => revoke(invitation.id)}
                  >
                    {t("revoke")}
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
