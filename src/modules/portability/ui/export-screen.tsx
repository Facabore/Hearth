"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button, ChoiceGroup, ScreenHeader, Sheet } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { SpaceDto } from "@/shared/ui/api/dto";
import { useToast } from "@/shared/ui/molecules/toast";
import { Column, Pinned, RefusalNotice, SectionTitle, useCall, useNameList } from "./parts";

type Format = "json" | "csv";

/** `attachment; filename="hearth-export-2026-11-15.zip"` → its name; the export always sends one (design §3.6). */
export const fileNameOf = (disposition: string | null, format: Format): string =>
  /filename="([^"]+)"/.exec(disposition ?? "")?.[1] ?? `hearth-export.${format === "csv" ? "zip" : "json"}`;

/** The browser saves a file the page holds: an object URL on a temporary link, clicked once and let go. */
export const saveFile = (blob: Blob, name: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

/**
 * D28, board "7 · Exportar mis datos": JSON or CSV (a ZIP), every space of the person's or only one, what the file
 * holds and what it never does (another member's personal accounts, D9), and "Descargar", which fetches the file and
 * saves it under the name the API gives it. Asking too often answers 429, which says to wait a minute.
 */
export function ExportScreen({
  backHref,
  spaces,
  api: injected,
}: {
  readonly backHref: string;
  /** The person's spaces, their personal one first. */
  readonly spaces: readonly SpaceDto[];
  readonly api?: Api;
}) {
  const t = useTranslations("portability.export");
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const toast = useToast();
  const names = useNameList();
  const [format, setFormat] = useState<Format>("json");
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const { pending, refusal, run } = useCall();
  const chosen = spaces.find((space) => space.id === spaceId);
  const download = async () => {
    let disposition: string | null = null;
    const blob = await run(async () => {
      const result = await api.GET("/api/v1/me/export", {
        params: { query: { format, ...(spaceId ? { spaceId } : {}) } },
        parseAs: "blob",
      });
      disposition = result.response.headers.get("content-disposition");
      return result;
    });
    if (blob) {
      saveFile(blob as Blob, fileNameOf(disposition, format));
      toast.show({ message: t("downloaded") });
    }
  };
  return (
    <Column>
      <ScreenHeader backHref={backHref} title={t("title")} />
      <p className="text-[15px] text-muted">{t("intro")}</p>
      <section aria-labelledby="export-format" className="flex flex-col gap-2">
        <SectionTitle id="export-format">{t("format")}</SectionTitle>
        <ChoiceGroup
          label={t("format")}
          labelledBy="export-format"
          layout="chips"
          value={format}
          options={[
            { value: "json", label: "JSON" },
            { value: "csv", label: "CSV" },
          ]}
          onValueChange={setFormat}
        />
        <p className="text-sm text-muted">{t("formatNote")}</p>
      </section>
      <section aria-labelledby="export-scope" className="flex flex-col gap-2">
        <SectionTitle id="export-scope">{t("scope")}</SectionTitle>
        <ChoiceGroup
          label={t("scope")}
          labelledBy="export-scope"
          layout="list"
          value={spaceId === null ? "all" : "one"}
          options={[
            {
              value: "all",
              label: t("all"),
              description: names(
                spaces.map((space) => space.name),
                4,
              ),
            },
            { value: "one", label: t("one"), description: chosen?.name ?? t("pick") },
          ]}
          onValueChange={(scope) => {
            if (scope === "all") setSpaceId(null);
            else setPicking(true);
          }}
        />
      </section>
      <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-[15px] font-semibold text-ink">{t("includes")}</h2>
        <p className="text-[15px] text-ink">{t("includesBody")}</p>
        <p className="text-[15px] text-ink">{t("never")}</p>
      </div>
      {refusal ? <RefusalNotice refusal={refusal} tooMany={t("tooMany")} /> : null}
      <Sheet open={picking} onOpenChange={setPicking} title={t("one")}>
        <ChoiceGroup
          label={t("space")}
          layout="list"
          value={spaceId ?? ""}
          options={spaces.map((space) => ({ value: space.id, label: space.name }))}
          onValueChange={(id) => {
            setSpaceId(id);
            setPicking(false);
          }}
        />
      </Sheet>
      <Pinned>
        <Button size="lg" disabled={pending} onClick={() => void download()}>
          {pending ? t("downloading") : t("download")}
        </Button>
      </Pinned>
    </Column>
  );
}
