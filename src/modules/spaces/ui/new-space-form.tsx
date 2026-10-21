"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent } from "react";
import { Button, ChoiceGroup, ProblemNotice, ScreenHeader, TextField } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import { fieldOf, problemFrom, type Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";

export const SPACE_CURRENCIES = ["COP", "USD", "EUR"] as const;
type SpaceCurrency = (typeof SPACE_CURRENCIES)[number];

/** HU-E9-05, the NewSpace artboard without its period controls (ruling P161): a name and a currency. */
export function NewSpaceForm({
  backHref,
  api: injected,
}: {
  /** The home of the space the person came from. */
  readonly backHref: string;
  readonly api?: Api;
}) {
  const t = useTranslations("spaces");
  const router = useRouter();
  const messageOf = useProblemMessage();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<SpaceCurrency>("COP");
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  const where = problem
    ? fieldOf(problem, { InvalidSpaceName: "name", UnknownCurrency: "currency" }, ["name", "currency"])
    : null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProblem(null);
    setPending(true);
    try {
      const { data, error, response } = await api.POST("/api/v1/spaces", {
        body: { kind: "SHARED", name: name.trim(), currency },
      });
      if (response.ok && data) {
        router.push(`/spaces/${data.id}/members`);
        router.refresh();
        return;
      }
      setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };

  return (
    <div className="flex flex-col gap-5 py-4">
      <ScreenHeader backHref={backHref} title={t("new.title")} />
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-5">
        <TextField
          id="space-name"
          label={t("new.name")}
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={where === "name" && problem ? messageOf(problem).message : undefined}
          required
        />
        <div className="flex flex-col gap-2">
          <ChoiceGroup
            label={t("new.currency")}
            layout="chips"
            value={currency}
            onValueChange={setCurrency}
            describedBy="space-currency-hint"
            options={SPACE_CURRENCIES.map((code) => ({ value: code, label: t(`currency.${code}`) }))}
          />
          <p id="space-currency-hint" className="text-sm text-muted">
            {t("new.currencyHint")}
          </p>
        </div>
        <p className="text-sm text-muted">{t("new.note")}</p>
        {problem && where !== "name" ? <ProblemNotice problem={problem} /> : null}
        <Button type="submit" size="lg" disabled={pending}>
          {t("new.create")}
        </Button>
      </form>
    </div>
  );
}
