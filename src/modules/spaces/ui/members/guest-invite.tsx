"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { localDateIn } from "@/shared/kernel/time-zone";
import { Button, CopyField, ProblemNotice } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { Problem } from "@/shared/ui/api/problem";
import { formatDate, type Formats } from "@/shared/ui/format/formatters";
import { createClaimLink, type ClaimLink } from "./claim-link";

/**
 * Ruling P338 (board "Amigo · Mom"): a guest of Amigos is invited to Hearth with the guest sheet's own single-use claim
 * link (P163), so whoever claims it keeps the history between the two. "Invitar" creates it; the link then shows with
 * its copy button and when it expires, and lives only in this component's state.
 */
export function GuestInvite({
  spaceId,
  guestId,
  formats,
  viewerZone,
  api: injected,
}: {
  /** The direct space the guest is in. */
  readonly spaceId: string;
  readonly guestId: string;
  readonly formats: Formats;
  readonly viewerZone: string;
  readonly api?: Api;
}) {
  const t = useTranslations("friends.person");
  const guest = useTranslations("members.guest");
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [claim, setClaim] = useState<ClaimLink | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, setPending] = useState(false);
  const invite = async () => {
    setPending(true);
    setProblem(null);
    const created = await createClaimLink(api, spaceId, guestId);
    if ("claim" in created) setClaim(created.claim);
    else setProblem(created.problem);
    setPending(false);
  };
  return (
    <section aria-label={t("invite")} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3">
        <p className="min-w-0 flex-[1_1_12rem] text-[15px] text-ink">{t("invite")}</p>
        {claim ? null : (
          <Button
            variant="ghost"
            size="compact"
            className="-mr-2 ml-auto shrink-0"
            disabled={pending}
            onClick={() => void invite()}
          >
            {t("inviteAction")}
          </Button>
        )}
      </div>
      {claim ? (
        <CopyField
          id="friend-claim-url"
          label={guest("claimLabel")}
          value={claim.url}
          note={guest("claimNote", {
            date: formatDate(localDateIn(new Date(claim.expiresAt), viewerZone), formats),
          })}
        />
      ) : null}
      {problem ? <ProblemNotice problem={problem} /> : null}
    </section>
  );
}
