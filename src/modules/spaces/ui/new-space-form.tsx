"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent } from "react";
import { Button, ProblemNotice, ScreenHeader, TextField } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import { fieldOf, problemFrom, type Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import {
  DEFAULT_PERIOD_DRAFT,
  PeriodPolicyFields,
  periodPolicyOf,
  type PeriodDraft,
} from "./period-policy-fields";

export const SPACE_CURRENCIES = ["COP", "USD", "EUR"] as const;
type SpaceCurrency = (typeof SPACE_CURRENCIES)[number];

/**
 * HU-E9-05, the board "Crear espacio compartido desde el selector": a name, a currency and, since #240, the budget
 * period ("Período del presupuesto", "Día de corte" and the line under them, `PeriodPolicyFields`), which
 * `POST /api/v1/spaces` takes as `periodPolicy`. On its own route the form draws its page header (`backHref`); inside
 * the switcher's sheet it does not, and `onCreated` closes the sheet once the space exists.
 */
export function NewSpaceForm({
  backHref,
  onCreated,
  api: injected,
}: {
  /** The home of the space the person came from; without it the form sits in a sheet that has its own header. */
  readonly backHref?: string;
  readonly onCreated?: () => void;
  readonly api?: Api;
}) {
  const t = useTranslations("spaces");
  const router = useRouter();
  const messageOf = useProblemMessage();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<SpaceCurrency>("COP");
  const [period, setPeriod] = useState<PeriodDraft>(DEFAULT_PERIOD_DRAFT);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  const where = problem
    ? fieldOf(
        problem,
        { InvalidSpaceName: "name", UnknownCurrency: "currency", InvalidPeriodPolicy: "periodPolicy" },
        ["name", "currency", "periodPolicy"],
      )
    : null;
  const typedName = name.trim();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProblem(null);
    setPending(true);
    try {
      const { data, error, response } = await api.POST("/api/v1/spaces", {
        body: { kind: "SHARED", name: typedName, currency, periodPolicy: periodPolicyOf(period) },
      });
      if (response.ok && data) {
        const members = `/spaces/${data.id}/members`;
        // The page's form leaves the history it replaced; the sheet's screen stays under the new space, so Back
        // and Volver return to it.
        if (onCreated) {
          onCreated();
          router.push(members);
        } else router.replace(members);
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
    <div className={backHref ? "flex flex-col gap-3 py-3" : "flex flex-col gap-3"}>
      {/* The screen draws the shell itself: a prefetch of the space's home would load its script again (#196). */}
      {backHref ? <ScreenHeader backHref={backHref} title={t("new.title")} prefetch={false} /> : null}
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-3">
        <TextField
          id="space-name"
          label={t("new.name")}
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={where === "name" && problem ? messageOf(problem).message : undefined}
          required
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="space-currency" className="text-sm font-medium text-ink">
            {t("new.currency")}
          </label>
          {/* The board's select: a native one, with its own arrow, so the platform's picker opens on a phone. */}
          <select
            id="space-currency"
            value={currency}
            aria-describedby="space-currency-hint"
            // Its options are SPACE_CURRENCIES only, so UnknownCurrency never comes from here.
            onChange={(event) => setCurrency(event.target.value as SpaceCurrency)}
            className="h-[52px] w-full rounded-xl border border-field bg-surface px-4 text-base text-ink"
          >
            {SPACE_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {t(`currency.${code}`)}
              </option>
            ))}
          </select>
          <p id="space-currency-hint" className="text-sm text-muted">
            {t("new.currencyHint")}
          </p>
        </div>
        <PeriodPolicyFields
          draft={period}
          onChange={setPeriod}
          error={where === "periodPolicy" && problem ? messageOf(problem).message : undefined}
        />
        <p className="text-sm text-muted">
          {typedName ? t("new.noteNamed", { space: typedName }) : t("new.note")}
        </p>
        {problem && where !== "name" && where !== "periodPolicy" ? <ProblemNotice problem={problem} /> : null}
        <Button type="submit" size="lg" disabled={pending}>
          {t("new.create")}
        </Button>
      </form>
    </div>
  );
}
