"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { localDateIn } from "@/shared/kernel/time-zone";
import { Button, ProblemNotice } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { InvitationDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { formatDate, formatNumber, type Formats } from "@/shared/ui/format/formatters";
import { useToast } from "@/shared/ui/molecules/toast";

/**
 * HU-E9-05, ruling P155, the Main artboard's "Invitaciones pendientes": the invitations that can still be accepted,
 * each with Revoke. Never Copy: only the token's hash is stored, so a URL cannot be shown again. #218, ruling P264: a
 * link says whether it serves one person (ADMIN) or several, and next to Revoke how many people joined through it; a
 * link with no recorded use (or from before #218, without the count) shows no count.
 *
 * The board "Invitación revocada con deshacer" (ruling P272): Revoke hides the invitation and the toast offers
 * Deshacer. Ruling P274: the revoke is sent at once, so an invitation the person saw revoked is never usable after it;
 * Deshacer asks the API to restore it (within 30 seconds of the revoke), and it comes back into the list.
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
  const messageOf = useProblemMessage();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [problem, setProblem] = useState<Problem | null>(null);
  // Each revoke Deshacer may still undo, by invitation: whether the API accepted it, once it answers.
  const revoking = useRef(new Map<string, Promise<boolean>>());

  const show = (invitationId: string) =>
    setHidden((current) => new Set([...current].filter((id) => id !== invitationId)));

  const send = async (invitationId: string): Promise<boolean> => {
    try {
      const { error, response } = await api.POST(
        "/api/v1/spaces/{spaceId}/invitations/{invitationId}/revoke",
        { params: { path: { spaceId, invitationId } } },
      );
      if (response.ok) {
        router.refresh();
        return true;
      }
      setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    revoking.current.delete(invitationId);
    show(invitationId);
    return false;
  };

  const restore = async (invitationId: string) => {
    try {
      const { error, response } = await api.POST(
        "/api/v1/spaces/{spaceId}/invitations/{invitationId}/restore",
        { params: { path: { spaceId, invitationId } } },
      );
      if (response.ok) {
        revoking.current.delete(invitationId);
        show(invitationId);
        router.refresh();
        return;
      }
      const refused = problemFrom(error, response);
      // Too late, or used meanwhile: the invitation stays revoked, and the toast says so where Deshacer was.
      if (refused.code === "InvitationNotRestorable")
        toast.show({ tone: "alert", message: messageOf(refused).message });
      else setProblem(refused);
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
  };

  // The restore waits for the revoke's answer, so it never reaches the API before the revoke it undoes.
  const undo = async (invitationId: string) => {
    const revoked = revoking.current.get(invitationId);
    if (revoked === undefined || !(await revoked)) return;
    await restore(invitationId);
  };

  const revoke = (invitationId: string) => {
    if (revoking.current.has(invitationId)) return;
    setProblem(null);
    setHidden((current) => new Set([...current, invitationId]));
    revoking.current.set(invitationId, send(invitationId));
    toast.show({
      message: t("revoked"),
      action: { label: t("undo"), onAction: () => void undo(invitationId) },
    });
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
