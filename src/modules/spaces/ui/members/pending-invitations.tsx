"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { localDateIn } from "@/shared/kernel/time-zone";
import { Button, ProblemNotice } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { InvitationDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { formatDate, formatNumber, type Formats } from "@/shared/ui/format/formatters";

/**
 * HU-E9-05, ruling P155, the Main artboard's "Invitaciones pendientes": the invitations that can still be accepted,
 * each with Revoke. Never Copy: only the token's hash is stored, so a URL cannot be shown again. #218, ruling P264: a
 * link says whether it serves one person (ADMIN) or several, and next to Revoke how many people joined through it; a
 * link with no recorded use (or from before #218, without the count) shows no count.
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
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  if (invitations.length === 0) return null;

  const revoke = async (invitationId: string) => {
    setRevoking(invitationId);
    setProblem(null);
    try {
      const { error, response } = await api.POST(
        "/api/v1/spaces/{spaceId}/invitations/{invitationId}/revoke",
        { params: { path: { spaceId, invitationId } } },
      );
      if (response.ok) {
        router.refresh();
      } else {
        setProblem(problemFrom(error, response));
      }
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setRevoking(null);
  };

  return (
    <section aria-labelledby="members-pending" className="flex flex-col gap-1.5">
      <h2 id="members-pending" className="text-sm font-semibold text-muted">
        {t("pending")}
      </h2>
      {problem ? <ProblemNotice problem={problem} /> : null}
      <ul className="divide-y divide-line rounded-2xl bg-surface px-3">
        {invitations.map((invitation) => {
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
                  disabled={revoking === invitation.id}
                  aria-label={email ? t("revokeEmail", { email }) : t("revokeLink", { role })}
                  onClick={() => void revoke(invitation.id)}
                >
                  {t("revoke")}
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
