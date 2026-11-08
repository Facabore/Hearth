"use client";

import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { Button, ChoiceGroup, ProblemNotice, TextField } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { CategoryDto, CategoryGroupDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";

export interface NewCategoryFormProps {
  readonly api: Api;
  readonly spaceId: string;
  /** The live groups of the movement's kind; the new category goes in one of them. */
  readonly groups: readonly CategoryGroupDto[];
  readonly groupId: string;
  readonly name: string;
  /** The movement's kind: an income's button says "ingreso", any other "gasto". */
  readonly kind: string;
  readonly onCreated: (category: CategoryDto) => void;
}

/**
 * Ruling P308 (board "Nueva categoría en Viaje: nombre y grupo · P308"): a name and a group, nothing else. It creates
 * the category in the record form's space, which takes its group's style, and hands it back to be chosen. It loads
 * on the first "Nueva categoría" (ADR 0004), beside the picker it opens from.
 */
export function NewCategoryForm({
  api,
  spaceId,
  groups,
  groupId,
  name,
  kind,
  onCreated,
}: NewCategoryFormProps) {
  const t = useTranslations("categories.picker");
  const id = useId();
  const [typed, setTyped] = useState(name);
  const [group, setGroup] = useState(groupId);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const trimmed = typed.trim();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (trimmed === "" || pending) return;
    setPending(true);
    setProblem(null);
    try {
      const { data, error, response } = await api.POST("/api/v1/spaces/{spaceId}/categories", {
        params: { path: { spaceId } },
        body: { groupId: group, name: trimmed },
      });
      if (response.ok) return onCreated(data as CategoryDto);
      setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };
  // The picker's portal puts this form outside the record form's in the page, but React still bubbles its submit
  // through the portal into the record form, so `submit` stops it there.
  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
      <TextField
        id={`${id}-name`}
        label={t("name")}
        value={typed}
        maxLength={60}
        autoComplete="off"
        autoFocus
        onChange={(event) => setTyped(event.target.value)}
      />
      <ChoiceGroup
        label={t("group")}
        layout="chips"
        value={group}
        onValueChange={setGroup}
        options={groups.map((g) => ({ value: g.id, label: g.name }))}
      />
      {problem ? <ProblemNotice problem={problem} /> : null}
      <Button type="submit" disabled={trimmed === "" || pending}>
        {t("save", { kind })}
      </Button>
    </form>
  );
}
