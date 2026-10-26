"use client";

import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import type { PaletteKey } from "@/shared/kernel/style";
import { Button, ProblemNotice, Sheet, TextField } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { CategoryGroupDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { ColorRow } from "./color-row";
import { IconPicker } from "./icon-picker";
import type { IconChoice } from "./style-library";

/** HU-E3-05: the style a group created without one takes, shown preselected. */
const DEFAULT_ICON: IconChoice = { kind: "SYMBOL", name: "tag" };
const DEFAULT_COLOR: PaletteKey = "GRAPHITE";

/**
 * HU-E9-04: "New group", from the screen's header or the category sheet's group choice: a name, the icon picker and the
 * color row, then `CreateCategoryGroup`. Closing leaves without creating, and the sheet underneath keeps its draft.
 */
export function GroupSheet({
  spaceId,
  onClose,
  onCreated,
  api: injected,
}: {
  readonly spaceId: string;
  readonly onClose: () => void;
  readonly onCreated: (group: Omit<CategoryGroupDto, "categories">) => void;
  readonly api?: Api;
}) {
  const t = useTranslations("categories.groupSheet");
  const id = useId();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<IconChoice>(DEFAULT_ICON);
  const [color, setColor] = useState<PaletteKey>(DEFAULT_COLOR);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  const create = async () => {
    setPending(true);
    setProblem(null);
    try {
      const { data, error, response } = await api.POST("/api/v1/spaces/{spaceId}/category-groups", {
        params: { path: { spaceId } },
        body: { name: name.trim(), icon, color },
      });
      if (data) {
        onCreated(data);
        return;
      }
      setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("title")}
      footer={
        <Button size="lg" disabled={pending || name.trim() === ""} onClick={() => void create()}>
          {t("create")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          id={`${id}-name`}
          label={t("name")}
          value={name}
          maxLength={200}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
        <IconPicker value={icon} onValueChange={setIcon} />
        <ColorRow value={color} onValueChange={setColor} />
        {problem ? <ProblemNotice problem={problem} /> : null}
      </div>
    </Sheet>
  );
}
