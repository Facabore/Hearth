"use client";

import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { Button, ProblemNotice, Sheet, TextField } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { CategoryGroupDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { formatCount } from "@/shared/ui/format/count";
import type { NumberFormat } from "@/shared/ui/format/formatters";
import { CategoryIcon } from "./category-icon";

/** P347, the boards' soft red «Eliminar grupo»: a 56 px target with no border, as the guest sheet's removal. */
const SOFT_DANGER =
  "inline-flex h-14 w-full items-center justify-center gap-2 rounded-[14px] bg-danger/10 px-6 text-base font-semibold text-danger disabled:cursor-not-allowed disabled:opacity-50";
/** P347, the confirmation's solid red «Eliminar grupo»; `on-accent` reads on `danger` in both themes. */
const SOLID_DANGER =
  "inline-flex h-14 w-full items-center justify-center gap-2 rounded-[14px] bg-danger px-6 text-base font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-50";

/** "A", "A y B", "A, B y C": the names as the copy lists them, the last joined by the language's word. */
const listed = (names: readonly string[], and: (list: string, last: string) => string): string =>
  names.length <= 1 ? (names[0] ?? "") : and(names.slice(0, -1).join(", "), names.at(-1)!);

/**
 * P347, boards "Editar grupo · hoja · propuesta" and "¿Eliminar Comida? · confirmación · propuesta": a group's name
 * (renamed through `PATCH …/category-groups/{groupId}`), the live categories it holds, and «Eliminar grupo», which asks
 * first in a sheet of its own. Deleting is logical on the server (D8) and allowed whatever uses the categories; past
 * movements keep naming them. Only who manages the tree opens it.
 */
export function GroupEditSheet({
  spaceId,
  group,
  formats,
  onClose,
  onSaved,
  onDeleted,
  api: injected,
}: {
  readonly spaceId: string;
  readonly group: CategoryGroupDto;
  readonly formats: { readonly numberFormat: NumberFormat };
  readonly onClose: () => void;
  readonly onSaved: (group: Omit<CategoryGroupDto, "categories">) => void;
  readonly onDeleted: (groupId: string) => void;
  readonly api?: Api;
}) {
  const t = useTranslations("categories.groupSheet");
  const catalog = useTranslations("categories");
  const common = useTranslations("common");
  const id = useId();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [name, setName] = useState(group.name);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  const live = group.categories.filter((category) => category.archivedAt === null);
  const n = live.length;
  const names = listed(
    live.map((category) => category.name),
    (list, last) => t("and", { list, last }),
  );
  const count = formatCount(n, formats);
  const path = { spaceId, groupId: group.id };
  const dirty = name.trim() !== "" && name.trim() !== group.name;

  const run = async (request: () => Promise<{ error?: unknown; response: Response }>, done: () => void) => {
    setPending(true);
    setProblem(null);
    try {
      const { error, response } = await request();
      if (response.ok) {
        done();
        return;
      }
      setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };

  const save = () => {
    let saved: Omit<CategoryGroupDto, "categories"> | undefined;
    return run(
      async () => {
        const answer = await api.PATCH("/api/v1/spaces/{spaceId}/category-groups/{groupId}", {
          params: { path },
          body: { name: name.trim() },
        });
        saved = answer.data;
        return answer;
      },
      () => {
        if (saved) onSaved(saved);
        onClose();
      },
    );
  };

  const remove = () =>
    run(
      () => api.DELETE("/api/v1/spaces/{spaceId}/category-groups/{groupId}", { params: { path } }),
      () => {
        onDeleted(group.id);
        onClose();
      },
    );

  const onOpenChange = (open: boolean) => {
    if (!open) onClose();
  };

  if (confirming) {
    return (
      <Sheet
        open
        onOpenChange={onOpenChange}
        title={t("confirmTitle", { name: group.name })}
        footer={
          <div className="flex flex-col gap-2">
            <button type="button" className={SOLID_DANGER} disabled={pending} onClick={() => void remove()}>
              {t("delete")}
            </button>
            <Button
              variant="secondary"
              size="lg"
              disabled={pending}
              onClick={() => {
                setProblem(null);
                setConfirming(false);
              }}
            >
              {common("cancel")}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 text-sm text-ink">
          {n === 0 ? (
            <p>{t("confirmEmpty")}</p>
          ) : (
            <>
              <p>{t("confirmCategories", { n, count, names })}</p>
              <p>{t("confirmHistory", { n })}</p>
            </>
          )}
          {problem ? <ProblemNotice problem={problem} /> : null}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open
      onOpenChange={onOpenChange}
      title={t("editTitle")}
      leading={<CategoryIcon icon={group.icon} color={group.color} size={40} />}
      footer={
        <div className="flex flex-col gap-3">
          {problem ? <ProblemNotice problem={problem} /> : null}
          <button
            type="button"
            className={SOFT_DANGER}
            disabled={pending}
            onClick={() => {
              setProblem(null);
              setConfirming(true);
            }}
          >
            {t("delete")}
          </button>
          <Button size="lg" className="w-full" disabled={pending || !dirty} onClick={() => void save()}>
            {catalog("sheet.save")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2.5">
        <TextField
          id={`${id}-name`}
          label={catalog("sheet.name")}
          value={name}
          maxLength={200}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
        <p className="text-sm [overflow-wrap:anywhere] text-muted">{t("categories", { n, count, names })}</p>
      </div>
    </Sheet>
  );
}
