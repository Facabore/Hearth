"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Avatar, Button, ChoiceGroup, Sheet, TextField } from "@/shared/ui";
import type { Person } from "./counterparts";
import type { DirectChoice } from "./direct-request";

export interface SplitWithPersonSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly people: readonly Person[];
  /** The Personal space's currency: a new direct space is created in it. */
  readonly currency: string;
  readonly onChoose: (choice: DirectChoice) => void;
}

/** HU-E9-06, the SplitWithPerson artboard (ruling P172): who to split with, from the people the recorder shares a space with. */
export function SplitWithPersonSheet({
  open,
  onOpenChange,
  people,
  currency,
  onChoose,
}: SplitWithPersonSheetProps) {
  const t = useTranslations("ledger.direct");
  const names = useTranslations("members");
  const [picked, setPicked] = useState("");
  const [guest, setGuest] = useState("");
  const person = people.find((p) => p.memberId === picked);
  const guestName = guest.trim();

  // Each time the sheet closes it forgets what was typed, so the next opening starts clean.
  const close = () => {
    setPicked("");
    setGuest("");
    onOpenChange(false);
  };
  const choose = (choice: DirectChoice) => {
    onChoose(choice);
    close();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={t("title")}
      description={t("intro", { currency })}
      footer={
        <Button
          size="lg"
          disabled={!person}
          onClick={() => person && choose({ kind: "MEMBER", memberId: person.memberId, name: person.name })}
        >
          {t("continue", { name: person?.name ?? "" })}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pt-2">
        <div className="flex flex-col gap-2">
          {people.length > 0 ? (
            <ChoiceGroup
              label={t("people")}
              layout="chips"
              value={picked}
              onValueChange={setPicked}
              options={people.map((p) => ({
                value: p.memberId,
                label: (
                  <span className="flex max-w-full items-center gap-3 py-2 text-left">
                    <Avatar name={p.name} size={32} />
                    <span className="flex min-w-0 flex-col">
                      <span className="break-words text-ink">
                        {p.isGuest ? `${p.name} ${names("guestSuffix")}` : p.name}
                      </span>
                      <span className="text-xs font-normal break-words text-muted">
                        {p.directSpace === null
                          ? t("new")
                          : p.isGuest
                            ? t("guestOf", { space: p.directSpace })
                            : t("existing", { space: p.directSpace })}
                      </span>
                    </span>
                  </span>
                ),
              }))}
            />
          ) : null}
          <p className="text-sm text-muted">{t("guestsNote")}</p>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-muted">{t("newGuest")}</h3>
          <TextField
            id="direct-guest"
            label={t("guestName")}
            autoComplete="off"
            value={guest}
            onChange={(event) => setGuest(event.target.value)}
          />
          <Button
            variant="secondary"
            className="self-start"
            disabled={guestName === ""}
            onClick={() => choose({ kind: "GUEST", displayName: guestName })}
          >
            {t("use")}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
