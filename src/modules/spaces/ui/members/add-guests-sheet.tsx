"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { Button, Icon, ProblemNotice, Sheet, TextField } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { MemberDto, SpaceDto } from "@/shared/ui/api/dto";
import { fieldOf, problemFrom, type Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";

type GuestField = "displayName" | "contactEmail";
const FIELDS: readonly GuestField[] = ["displayName", "contactEmail"];

interface GuestCard {
  readonly key: number;
  readonly name: string;
  readonly email: string;
}

/** A card the person left blank is not a guest: it is never sent. */
const isBlank = (card: GuestCard) => card.name.trim() === "" && card.email.trim() === "";

/**
 * Where a refusal of the batch belongs: the card the API names (`guest`, ruling P309) and its field, or the card and
 * field of the first validation path (`guests.1.contactEmail`); otherwise the form.
 */
const placeOf = (problem: Problem): { readonly index: number; readonly field: GuestField } | null => {
  if (problem.guest !== undefined) {
    const field = fieldOf(
      problem,
      { MemberNameTaken: "displayName", InvalidMemberName: "displayName", InvalidEmail: "contactEmail" },
      FIELDS,
    );
    return field === "form" ? null : { index: problem.guest, field };
  }
  const path = /^guests\.(\d+)\.(displayName|contactEmail)$/.exec(problem.errors[0]?.path ?? "");
  return path ? { index: Number(path[1]), field: path[2] as GuestField } : null;
};

/**
 * HU-E9-05, rulings P163 and P309, the boards "Agregar invitados · varios a la vez" and "… · nombre repetido": one card
 * per guest, a member without an account named by the person adding them; the optional email is only remembered,
 * nothing is sent to it. The guests are added in one request, all or nothing, and a refused name shows on its card.
 */
export function AddGuestsSheet({
  open,
  onOpenChange,
  space,
  api: injected,
  onAdded,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly space: Pick<SpaceDto, "id" | "name">;
  readonly api?: Api;
  /** The members just added, in the cards' order, before the sheet closes (the split sheet selects them, S6). */
  readonly onAdded?: (members: MemberDto[]) => void;
}) {
  const t = useTranslations("members");
  const router = useRouter();
  const problemMessage = useProblemMessage();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const nextKey = useRef(1);
  const [cards, setCards] = useState<GuestCard[]>([{ key: 0, name: "", email: "" }]);
  const [problem, setProblem] = useState<Problem | null>(null);
  // The cards the last request sent, so the API's index names the right card.
  const [sentKeys, setSentKeys] = useState<number[]>([]);
  const [pending, setPending] = useState(false);

  const edit = (key: number, change: Partial<Omit<GuestCard, "key">>) =>
    setCards((all) => all.map((card) => (card.key === key ? { ...card, ...change } : card)));
  const addCard = () => setCards((all) => [...all, { key: nextKey.current++, name: "", email: "" }]);
  const removeCard = (key: number) => {
    setCards((all) => all.filter((card) => card.key !== key));
    setProblem(null);
  };

  // At least one card is always sent: an empty name is the domain's to refuse, on the first card.
  const filled = cards.filter((card) => !isBlank(card));
  const toSend = filled.length > 0 ? filled : cards.slice(0, 1);

  const add = async () => {
    setPending(true);
    setProblem(null);
    setSentKeys(toSend.map((card) => card.key));
    try {
      const guests = toSend.map((card) => {
        const contactEmail = card.email.trim();
        return { displayName: card.name.trim(), ...(contactEmail ? { contactEmail } : {}) };
      });
      const { data, error, response } = await api.POST("/api/v1/spaces/{spaceId}/guests/batch", {
        params: { path: { spaceId: space.id } },
        body: { guests },
      });
      if (response.ok && data) {
        onAdded?.(data.items);
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

  const place = problem ? placeOf(problem) : null;
  const placedKey = place ? sentKeys[place.index] : undefined;
  const onCard = problem !== null && placedKey !== undefined && cards.some((card) => card.key === placedKey);
  const errorFor = (key: number, field: GuestField) =>
    problem && onCard && placedKey === key && place?.field === field
      ? problemMessage(problem).message
      : undefined;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("guestsSheet.title", { space: space.name })}
      description={t("guestsSheet.intro", { space: space.name })}
      footer={
        <Button size="lg" disabled={pending} onClick={() => void add()}>
          {t("guestsSheet.submit", { count: toSend.length })}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {cards.map((card, index) => {
          const number = index + 1;
          // The hint shows the name as the list will show it, live, once something is typed (the AddGuest artboard).
          const typed = card.name.trim();
          const nameHint = typed
            ? t("guestsSheet.nameHintNamed", { name: `${typed} ${t("guestSuffix")}` })
            : t("guestsSheet.nameHint");
          return (
            <div
              key={card.key}
              role="group"
              aria-labelledby={`guest-${card.key}-legend`}
              className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-surface p-3"
            >
              <div className="flex min-h-11 items-center justify-between gap-2">
                <p id={`guest-${card.key}-legend`} className="text-sm font-semibold text-ink">
                  {t("guestsSheet.guest", { number })}
                </p>
                {cards.length > 1 ? (
                  <Button variant="dangerGhost" size="compact" onClick={() => removeCard(card.key)}>
                    {t("guestsSheet.remove")}
                  </Button>
                ) : null}
              </div>
              <TextField
                id={`guest-${card.key}-name`}
                autoComplete="off"
                label={t("guestsSheet.name")}
                hint={nameHint}
                value={card.name}
                error={errorFor(card.key, "displayName")}
                onChange={(event) => edit(card.key, { name: event.target.value })}
              />
              <TextField
                id={`guest-${card.key}-email`}
                type="email"
                autoComplete="off"
                label={t("guestsSheet.email")}
                placeholder={t("guestsSheet.emailPlaceholder")}
                value={card.email}
                error={errorFor(card.key, "contactEmail")}
                onChange={(event) => edit(card.key, { email: event.target.value })}
              />
            </div>
          );
        })}
        <Button variant="secondary" size="md" className="w-full" onClick={addCard}>
          <Icon name="plus" size={20} />
          {t("guestsSheet.another")}
        </Button>
        <p role="note" className="flex items-start gap-3 rounded-2xl bg-track p-3 text-sm text-ink">
          <Icon name="alert" size={20} className="mt-0.5 shrink-0 text-muted" />
          {/* The board's info callout, worded for one guest or several. */}
          {t("guestsSheet.claimNote")}
        </p>
        {problem && onCard ? (
          <p role="alert" className="text-sm text-danger">
            {t("guestsSheet.nobodyYet")}
          </p>
        ) : null}
        {problem && !onCard ? <ProblemNotice problem={problem} /> : null}
      </div>
    </Sheet>
  );
}
