"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ChoiceGroup, Sheet } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";
import type { Person } from "../direct/counterparts";
import type { SummaryRow } from "./form-chip";
import { debtWith, effectOf, placeOf, type PersonTransfer } from "./person-transfer";

export interface PersonTransferRowsProps {
  readonly people: readonly Person[];
  readonly transfer: PersonTransfer;
  readonly onChange: (transfer: PersonTransfer) => void;
  /** The recorder's account's name, or null while none is chosen; tapping its row opens the form's picker. */
  readonly accountName: string | null;
  readonly onPickAccount: () => void;
  /** The account's problem, which the form shows under the rows; the row points at it. */
  readonly accountError?: string | undefined;
  /** Minor units of the amount, or null while there is none. */
  readonly amount: string | null;
  readonly currency: string;
  readonly formats: Formats;
  readonly api: Api;
  /**
   * The form's own summary row, handed in so this chunk does not load the record form's (ADR 0004, as the line editor's
   * payer sheet takes its helpers).
   */
  readonly Row: typeof SummaryRow;
}

type Opened = "person" | "space" | null;

/**
 * P334, board "Transferencia a alguien": to or from whom, the recorder's account, the space it is recorded in with
 * what they owed each other there, and a card with the effect on that space's debts only.
 */
export function PersonTransferRows(props: PersonTransferRowsProps) {
  const { people, transfer, onChange, currency, formats } = props;
  const t = useTranslations("ledger.personTransfer");
  const [opened, setOpened] = useState<Opened>(null);
  const person = people.find((p) => p.memberId === transfer.personId);
  const place = placeOf(person, transfer);
  const spaceId = place?.spaceId ?? null;
  const pair =
    place && place.myMemberId && place.theirMemberId ? [place.myMemberId, place.theirMemberId] : null;
  // What the two owe each other in that space only (P323's pairs); a direct space not made yet holds nothing.
  const [owed, setOwed] = useState<{ readonly spaceId: string | null; readonly minor: bigint } | null>(null);
  useEffect(() => {
    if (spaceId === null || pair === null) return;
    let live = true;
    void props.api
      .GET("/api/v1/spaces/{spaceId}/balances/suggestions", { params: { path: { spaceId } } })
      .then(({ data }) => {
        if (live && data) setOwed({ spaceId, minor: debtWith(data.suggestions, pair[0]!, pair[1]!) });
      })
      // Unread, the card waits and the row says only "Espacio": the transfer can still be saved.
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // The pair is derived from the place, which the space id names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.api, spaceId]);
  const debt = spaceId === null ? 0n : owed?.spaceId === spaceId ? owed.minor : null;
  const money = (minor: bigint) => formatMoney({ amount: String(minor), currency }, formats);
  const to = transfer.mode === "TO";
  const name = person?.name ?? "";
  const spaceName = place?.spaceId === null || !place ? t("newDirect", { name }) : (place.name ?? "");

  const effect =
    debt !== null && props.amount !== null && person && transfer.mode !== "OWN"
      ? effectOf(transfer.mode, debt, BigInt(props.amount))
      : null;
  const card =
    effect === null
      ? null
      : t(`effect.${effect.key}`, {
          name,
          ...("amount" in effect ? { amount: money(effect.amount) } : {}),
          ...("rest" in effect ? { rest: money(effect.rest) } : {}),
          ...("debt" in effect ? { debt: money(effect.debt) } : {}),
          ...("total" in effect ? { total: money(effect.total) } : {}),
        });
  const spaceMeta =
    debt === null || debt === 0n
      ? debt === null
        ? t("space")
        : t("even")
      : debt > 0n
        ? t("youOwed", { amount: money(debt) })
        : t("theyOwed", { amount: money(-debt) });

  if (people.length === 0) return <p className="py-2 text-sm text-muted">{t("noPeople")}</p>;
  return (
    <>
      {card ? (
        <div role="status" className="mb-2 rounded-2xl bg-accent-soft p-3 text-sm text-ink">
          <p>{card}</p>
          <p className="text-muted">{t("only", { space: spaceName })}</p>
        </div>
      ) : null}
      <props.Row
        value={person ? t(to ? "to" : "fromPerson", { name }) : t("choosePerson")}
        meta={t(to ? "toMeta" : "fromMeta")}
        onClick={() => setOpened("person")}
      />
      <props.Row
        value={props.accountName ? t(to ? "from" : "into", { account: props.accountName }) : t("yourAccount")}
        meta={t("yourAccount")}
        onClick={props.onPickAccount}
        errorId={props.accountError ? "record-account-error" : undefined}
      />
      {person ? (
        <props.Row
          value={t("in", { space: spaceName })}
          meta={spaceMeta}
          onClick={() => setOpened("space")}
        />
      ) : null}
      <Sheet
        open={opened === "person"}
        onOpenChange={(open) => setOpened(open ? "person" : null)}
        title={t(`personTitle.${to ? "TO" : "FROM"}`)}
      >
        <ChoiceGroup
          layout="list"
          label={t(`personTitle.${to ? "TO" : "FROM"}`)}
          value={transfer.personId ?? ""}
          onValueChange={(personId) => {
            onChange({ ...transfer, personId, placeIndex: 0 });
            setOpened(null);
          }}
          options={people.map((p) => ({ value: p.memberId, label: p.name }))}
        />
      </Sheet>
      {person ? (
        <Sheet
          open={opened === "space"}
          onOpenChange={(open) => setOpened(open ? "space" : null)}
          title={t("spaceTitle")}
        >
          <ChoiceGroup
            layout="list"
            label={t("spaceTitle")}
            value={String(transfer.placeIndex)}
            onValueChange={(index) => {
              onChange({ ...transfer, placeIndex: Number(index) });
              setOpened(null);
            }}
            options={person.places.map((p, index) => ({
              value: String(index),
              label: p.spaceId === null ? t("newDirect", { name }) : (p.name ?? ""),
              ...(p.spaceId === null ? { description: t("newDirectNote") } : {}),
            }))}
          />
        </Sheet>
      ) : null}
    </>
  );
}
