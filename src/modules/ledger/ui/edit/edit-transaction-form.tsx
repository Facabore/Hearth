"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { AccountDto, CategoryGroupDto, SpaceDto, TransactionDto } from "@/shared/ui/api/dto";
import { problemFrom } from "@/shared/ui/api/problem";
import type { Formats } from "@/shared/ui/format/formatters";
import { useToast } from "@/shared/ui/molecules/toast";
import { RecordForm } from "../record/record-form";
import { requestOf, type RecordKind } from "../record/record-request";
import type { When } from "../record/when-label";
import type { SharedExpenseContext } from "../split/shared-context";
import { withTx } from "../detail/tx-href";
import { initialOf, draftOf } from "./edit-initial";
import { editBodyOf, ifMatchOf } from "./edit-request";

/**
 * Rulings P191 and P193: the record form on a transaction. It sends only what changed, with the version it was loaded
 * at as `If-Match`; a stale version is shown as a conflict that loads the latest one, never merged or overwritten.
 */
export function EditTransactionForm({
  space,
  tx,
  accounts,
  groups,
  formats,
  profileZone,
  shared,
  origin,
  initialNow,
  api: injected,
}: {
  readonly space: SpaceDto;
  readonly tx: TransactionDto;
  readonly accounts: readonly AccountDto[];
  readonly groups: readonly CategoryGroupDto[];
  readonly formats: Formats;
  readonly profileZone: string;
  readonly shared?: SharedExpenseContext;
  /** The list or home it was opened from; the sheet of this transaction is shown there afterwards. */
  readonly origin: string;
  /** The server render's instant (ISO): an untimed row's made-up time must be the same on both renders. */
  readonly initialNow?: string;
  readonly api?: Api;
}) {
  const t = useTranslations("ledger");
  const router = useRouter();
  const toast = useToast();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  // P192: a timed row is read and written in its own zone; an untimed one in the editor's.
  const zone = tx.timeZone ?? profileZone;
  const [now] = useState(() => initialNow ?? new Date().toISOString());
  const [initial] = useState(() =>
    initialOf(tx, { groups, formats, zone, now: new Date(now), ...(shared ? { shared } : {}) }),
  );
  // What the untouched form would send: the diff is against this, never against the transaction (P192).
  const [baseline] = useState(() => {
    const memberIds = shared?.members.map((member) => member.id) ?? [];
    const built = requestOf(
      draftOf(initial, zone),
      space.currency,
      formats.numberFormat,
      initial.split ? { split: initial.split, memberIds } : undefined,
    );
    return built.ok ? built.body : {};
  });
  // Both ways out lead to the sheet of this transaction, in the place it was opened from.
  const sheet = withTx(origin, tx.id);

  const onSave = async (
    built: { kind: RecordKind; body: Record<string, unknown> },
    state: { when: When },
  ) => {
    const whenChanged = JSON.stringify(state.when) !== JSON.stringify(initial.when);
    const body = editBodyOf({ tx, baseline, current: built.body, whenChanged });
    if (Object.keys(body).length === 0) {
      router.replace(sheet);
      return null;
    }
    try {
      const { error, response } = await api.PATCH("/api/v1/spaces/{spaceId}/transactions/{transactionId}", {
        params: {
          path: { spaceId: space.id, transactionId: tx.id },
          header: { "if-match": ifMatchOf(tx.version) },
        },
        // Ruling P118: the form builds a plain object; the API is the validator of its shape.
        body: body as never,
      });
      if (response.ok) {
        // Replacing the entry keeps the browser's Back from returning to a form that was used (nav1).
        router.replace(sheet);
        router.refresh();
        toast.show({ message: t("toast.edited") });
        return null;
      }
      return problemFrom(error, response);
    } catch (error) {
      return problemFrom(error, undefined);
    }
  };

  return (
    <RecordForm
      space={space}
      accounts={accounts}
      groups={groups}
      formats={formats}
      initialKind={initial.kind}
      initialNow={now}
      timeZone={zone}
      profileZone={profileZone}
      api={api}
      {...(shared ? { shared } : {})}
      edit={{
        initial,
        backHref: sheet,
        onSave,
        problemAction: (problem) =>
          problem.code === "PreconditionFailed" ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted">{t("edit.reloadNote")}</p>
              <Button variant="secondary" onClick={() => router.refresh()}>
                {t("edit.reload")}
              </Button>
            </div>
          ) : null,
      }}
    />
  );
}
