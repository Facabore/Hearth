"use client";

import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { Button, Icon, ScreenHeader, SymbolIcon } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { ImportPreviewDto } from "./dto";
import { Column, Pinned, RefusalNotice, RowIcon, StaticRow, useCall } from "./parts";

/** Design §3.5: the API refuses a file over 20 MB; saying so before sending it saves the person the upload. */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

/** Refusals that may pass a moment later: the same file can simply go up again. */
const RETRYABLE = new Set(["TooManyRequests", "ImportTimedOut"]);

/** A refusal the screen gives itself, in the API's own words (`errors.ImportFileTooLarge`). */
const TOO_LARGE = {
  problem: { code: "ImportFileTooLarge", status: 422, requestId: null, errors: [], field: null },
  reason: null,
  sourceId: null,
} as const;

/**
 * D28, board "2 · Importar · Money Manager · elegir archivo": how to get the backup, the space it goes into (the
 * person's personal space, the only one an import goes to, design §3.2), and that the file is read and not kept. The
 * file goes up as it is; the generated client sends it with `fetch`, which reports no upload progress, so the screen
 * shows that the file is being read until the preview answers. A refusal shows its code's message, and only the
 * latest one shows: the screen's own "too large" and the API's never stand side by side. A 429 (too many uploads at
 * once) and an ImportTimedOut (a read or an upload that stalled) offer to send the same file again.
 */
export function MoneyManagerScreen({
  backHref,
  personal,
  onUploaded,
  api: injected,
}: {
  readonly backHref: string;
  readonly personal: { readonly id: string; readonly name: string; readonly currency: string };
  readonly onUploaded: (preview: ImportPreviewDto) => void;
  readonly api?: Api;
}) {
  const t = useTranslations("portability.moneyManager");
  const busy = useTranslations("portability")("busy");
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const input = useRef<HTMLInputElement>(null);
  const { pending, refusal, run, clear } = useCall();
  const [tooLarge, setTooLarge] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [last, setLast] = useState<File | null>(null);
  const upload = async (file: File) => {
    clear();
    setTooLarge(file.size > MAX_IMPORT_BYTES);
    if (file.size > MAX_IMPORT_BYTES) return;
    setLast(file);
    setReading(file.name);
    const form = new FormData();
    form.append("file", file);
    form.append("source", "money-manager");
    const preview = await run(() =>
      api.POST("/api/v1/spaces/{spaceId}/imports", {
        params: { path: { spaceId: personal.id } },
        // The typed body names the multipart fields; what goes on the wire is the form itself.
        body: { file: file.name, source: "money-manager" },
        bodySerializer: () => form,
      }),
    );
    setReading(null);
    if (preview) onUploaded(preview);
  };
  const steps = [t("step1"), t("step2"), t("step3")];
  return (
    <Column>
      <ScreenHeader backHref={backHref} title={t("title")} />
      <p className="text-[15px] text-muted">{t("intro")}</p>
      <ol className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
        {steps.map((step, index) => (
          <li key={step} className="flex items-start gap-3 text-[15px] text-ink">
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent"
            >
              {index + 1}
            </span>
            <span className="min-w-0 pt-0.5 [overflow-wrap:anywhere]">{step}</span>
          </li>
        ))}
      </ol>
      <StaticRow
        icon={
          <RowIcon>
            <SymbolIcon name="wallet" size={20} />
          </RowIcon>
        }
        title={t("destination")}
        note={t("destinationValue", { space: personal.name, currency: personal.currency })}
      />
      <p className="flex gap-2 text-sm text-muted">
        <Icon name="lock" size={18} className="shrink-0" />
        <span>{t("privacy")}</span>
      </p>
      {reading ? (
        <div role="status" className="flex flex-col gap-2 rounded-2xl bg-track p-3">
          <p className="text-[15px] break-all text-ink">{t("reading", { name: reading })}</p>
          <div
            role="progressbar"
            aria-label={t("progress")}
            className="h-1.5 overflow-hidden rounded-full bg-line"
          >
            <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
          </div>
          <p className="text-sm text-muted">{t("readingNote")}</p>
        </div>
      ) : null}
      {tooLarge ? <RefusalNotice refusal={TOO_LARGE} /> : null}
      {refusal ? <RefusalNotice refusal={refusal} tooMany={busy} /> : null}
      {refusal && last && RETRYABLE.has(refusal.problem.code) ? (
        <Button variant="secondary" size="md" disabled={pending} onClick={() => void upload(last)}>
          {t("retry")}
        </Button>
      ) : null}
      <input
        ref={input}
        type="file"
        accept=".mmbak,.sqlite"
        aria-label={t("file")}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          // The same file chosen again after a refusal still fires a change.
          event.currentTarget.value = "";
          if (file) void upload(file);
        }}
      />
      <Pinned>
        <Button size="lg" disabled={pending} onClick={() => input.current?.click()}>
          {t("choose")}
        </Button>
      </Pinned>
    </Column>
  );
}
