"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, type ReactNode } from "react";
import { absolute, memberSentence, netState } from "@/modules/balances/ui";
import { localDateIn } from "@/shared/kernel/time-zone";
import { Avatar, Button, CopyField, Icon, ProblemNotice, Sheet } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { MemberDto, MoneyDto, SpaceDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { formatDate, formatMoney, type Formats } from "@/shared/ui/format/formatters";
import type { MemberControls } from "./space-controls";

/** The board's soft red removal button: a 56 px target, no border. */
const REMOVE =
  "inline-flex h-14 w-full items-center justify-center gap-2 rounded-[14px] bg-danger/10 px-4 text-base font-semibold text-danger disabled:cursor-not-allowed disabled:opacity-50";

/** The sentence with its amount in bold, as the boards write a figure inside a line. */
const withAmount = (sentence: string, amount: string, className = ""): ReactNode => {
  const at = sentence.indexOf(amount);
  if (at < 0) return sentence;
  return (
    <>
      {sentence.slice(0, at)}
      <strong className={`font-semibold ${className}`}>{amount}</strong>
      {sentence.slice(at + amount.length)}
    </>
  );
};

/**
 * HU-E9-05, ruling P163, the boards "Invitado: enlace para reclamar y quitar con saldo" and "Quitar invitado sin saldo":
 * a guest's balance, a single-use claim link (7 days) and the removal. A guest with a balance cannot be removed, so the
 * sheet says so up front and offers to record the payment; a settled guest is removed after a confirmation of its own.
 * A claim link's URL comes back once (only its hash is stored), so it lives in this sheet's state and nowhere else; the
 * screen mounts the sheet only while it is open, so closing it forgets the URL.
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
  const state = netState(net);
  const amount = formatMoney(absolute(net), formats);
  // What still blocks the removal: the balance on screen, or the one the API answered when it refused.
  const outstanding = problem?.outstanding ?? (state === "settled" ? null : absolute(net));

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

  if (confirming) {
    return (
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title={t("guest.confirmTitle", { name: label, space: space.name })}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink">{withAmount(t("guest.confirmBody", { amount }), amount)}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" disabled={pending} onClick={() => setConfirming(false)}>
              {common("cancel")}
            </Button>
            <button type="button" className={REMOVE} disabled={pending} onClick={() => void remove()}>
              {t("guest.remove", { space: space.name })}
            </button>
          </div>
        </div>
      </Sheet>
    );
  }

  const sentence = memberSentence(net, formats, balances);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={label}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Avatar name={guest.displayName} size={48} />
          {/* The direction is in the words ("le toca poner"); the colour only repeats it. */}
          <p className="min-w-0 text-sm text-muted">
            {withAmount(
              t("guest.balance", { space: space.name, sentence }),
              amount,
              state === "owes" ? "text-owe-ink" : state === "owed" ? "text-accent" : "",
            )}
          </p>
        </div>
        {controls.claimLinks ? (
          <section
            aria-labelledby="claim-title"
            className="flex flex-col gap-2 rounded-2xl border border-accent/30 bg-accent-soft p-3"
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
            ) : (
              <Button variant="secondary" disabled={pending} onClick={() => void createClaim()}>
                {t("guest.createClaim")}
              </Button>
            )}
          </section>
        ) : null}
        {problem && !problem.outstanding ? <ProblemNotice problem={problem} /> : null}
        {controls.removeGuests ? (
          <>
            <hr className="border-line" />
            {outstanding ? (
              <div role="note" className="flex items-start gap-3 rounded-2xl bg-danger/10 p-3 text-danger">
                <Icon name="warning" size={20} className="mt-0.5 shrink-0" />
                <div className="flex min-w-0 flex-col items-start">
                  <p className="text-sm">
                    {t("guest.blocked", {
                      name: guest.displayName,
                      amount: formatMoney(outstanding, formats),
                    })}
                  </p>
                  <Link
                    href={`/spaces/${space.id}/balances?settle=${guest.id}`}
                    className="inline-flex min-h-11 items-center text-sm font-semibold"
                  >
                    {t("guest.settle")}
                  </Link>
                </div>
              </div>
            ) : null}
            <button
              type="button"
              className={REMOVE}
              disabled={outstanding !== null}
              onClick={() => setConfirming(true)}
            >
              <Icon name="userMinus" size={20} />
              {t("guest.remove", { space: space.name })}
            </button>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
