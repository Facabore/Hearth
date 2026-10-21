"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { memberSentence } from "@/modules/balances/ui";
import { localDateIn } from "@/shared/kernel/time-zone";
import { Button, CopyField, Icon, ProblemNotice, Sheet } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { MemberDto, MoneyDto, SpaceDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { formatDate, formatMoney, type Formats } from "@/shared/ui/format/formatters";
import type { MemberControls } from "./space-controls";

/**
 * HU-E9-05, ruling P163, the GuestSheet artboard: a guest's balance, a single-use claim link (7 days) and the removal
 * of a settled guest. A claim link's URL comes back once (only its hash is stored), so it lives in this sheet's state
 * and nowhere else; the screen mounts the sheet only while it is open, so closing it forgets the URL.
 */
export function GuestSheet({
  open,
  onOpenChange,
  space,
  guest,
  label,
  net,
  controls,
  formats,
  viewerZone,
  api: injected,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly space: Pick<SpaceDto, "id" | "name">;
  readonly guest: Pick<MemberDto, "id" | "displayName">;
  readonly label: string;
  readonly net: MoneyDto;
  readonly controls: Pick<MemberControls, "claimLinks" | "removeGuests">;
  readonly formats: Formats;
  readonly viewerZone: string;
  readonly api?: Api;
}) {
  const t = useTranslations("members");
  const balances = useTranslations("balances");
  const common = useTranslations("common");
  const router = useRouter();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [claim, setClaim] = useState<{ url: string; expiresAt: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, setPending] = useState(false);
  const path = { params: { path: { spaceId: space.id, memberId: guest.id } } };

  const createClaim = async () => {
    setPending(true);
    setProblem(null);
    try {
      const { data, error, response } = await api.POST(
        "/api/v1/spaces/{spaceId}/guests/{memberId}/claim-links",
        path,
      );
      if (response.ok && data) setClaim({ url: data.url, expiresAt: data.invitation.expiresAt });
      else setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };

  const remove = async () => {
    setPending(true);
    setProblem(null);
    try {
      const { error, response } = await api.DELETE("/api/v1/spaces/{spaceId}/guests/{memberId}", path);
      if (response.ok) {
        onOpenChange(false);
        router.refresh();
        return;
      }
      setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setConfirming(false);
    setPending(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={label}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          {t("guest.balance", { space: space.name, sentence: memberSentence(net, formats, balances) })}
        </p>
        {controls.claimLinks ? (
          <section
            aria-labelledby="claim-title"
            className="flex flex-col gap-2 rounded-2xl bg-accent-soft p-3"
          >
            <h3 id="claim-title" className="text-base font-semibold text-ink">
              {t("guest.claimTitle", { name: guest.displayName })}
            </h3>
            <p className="text-sm text-ink">{t("guest.claimBody", { space: space.name })}</p>
            {claim ? (
              <CopyField
                id="claim-url"
                label={t("guest.claimLabel")}
                value={claim.url}
                note={t("guest.claimNote", {
                  date: formatDate(localDateIn(new Date(claim.expiresAt), viewerZone), formats),
                })}
              />
            ) : null}
            <Button
              variant="secondary"
              disabled={pending || claim !== null}
              onClick={() => void createClaim()}
            >
              {t("guest.createClaim")}
            </Button>
          </section>
        ) : null}
        {problem ? (
          <ProblemNotice
            problem={problem}
            detail={
              problem.outstanding ? (
                <>
                  {t("guest.outstanding", { amount: formatMoney(problem.outstanding, formats) })}{" "}
                  <Link
                    href={`/spaces/${space.id}/balances?settle=${guest.id}`}
                    className="inline-flex min-h-11 items-center font-semibold underline"
                  >
                    {t("guest.settle")}
                  </Link>
                </>
              ) : undefined
            }
          />
        ) : null}
        {controls.removeGuests ? (
          confirming ? (
            <div className="flex flex-col gap-2 rounded-2xl bg-track p-3">
              <p className="text-sm text-ink">
                {t("guest.confirmRemove", { name: guest.displayName, space: space.name })}
              </p>
              <div className="flex gap-2">
                <Button variant="danger" disabled={pending} onClick={() => void remove()}>
                  {t("guest.confirmRemoveAction")}
                </Button>
                <Button variant="secondary" disabled={pending} onClick={() => setConfirming(false)}>
                  {common("cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="danger" size="lg" onClick={() => setConfirming(true)}>
              <Icon name="userMinus" size={20} />
              {t("guest.remove", { space: space.name })}
            </Button>
          )
        ) : null}
      </div>
    </Sheet>
  );
}
