"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { TextField } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { SpaceDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { controlsFor } from "./members/space-controls";

/** U5: how long a stored change says so, as the Settings screen's own fields do. */
const SAVED_MS = 2000;

/**
 * #167: the Settings screen's section for the space the person came from, where an OWNER or ADMIN renames it, the
 * personal one included. Like every setting there it has no Save button (ruling P137): the name is stored when the
 * field is left or on Enter, says Guardado for about two seconds (U5), and the refresh renames it in the shell. The
 * API stays the authority on the name (1 to 80 characters once trimmed): its refusal stays under the field.
 */
export function SpaceNameSection({ space, api: injected }: { readonly space: SpaceDto; readonly api?: Api }) {
  const t = useTranslations("spaces.settings");
  const common = useTranslations("settings");
  const router = useRouter();
  const messageOf = useProblemMessage();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [stored, setStored] = useState(space.name);
  const [name, setName] = useState(space.name);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlight = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!controlsFor(space.role, space.kind).rename) return null;

  const store = async () => {
    // Enter and then leaving the field would otherwise send the same name twice.
    if (inFlight.current || (name.trim() === stored && problem === null)) return;
    inFlight.current = true;
    setProblem(null);
    try {
      const { data, error, response } = await api.PATCH("/api/v1/spaces/{spaceId}", {
        params: { path: { spaceId: space.id } },
        body: { name: name.trim() },
      });
      if (data) {
        setStored(data.name);
        setName(data.name);
        clearTimeout(timer.current);
        setSaved(true);
        timer.current = setTimeout(() => setSaved(false), SAVED_MS);
        router.refresh();
      } else setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    } finally {
      inFlight.current = false;
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void store();
  };

  return (
    <section aria-labelledby="settings-space" className="relative flex flex-col gap-3">
      {saved ? (
        <span
          role="status"
          className="pointer-events-none absolute top-0 right-0 text-sm font-medium text-accent"
        >
          {common("saved")}
        </span>
      ) : null}
      <h2 id="settings-space" className="text-lg font-semibold text-ink">
        {t("title")}
      </h2>
      <form onSubmit={submit} noValidate>
        <TextField
          id="settings-space-name"
          label={t("name")}
          hint={t("nameHint")}
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void store()}
          error={problem ? messageOf(problem).message : undefined}
        />
      </form>
    </section>
  );
}
