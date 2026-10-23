"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent } from "react";
import {
  Button,
  ChoiceGroup,
  NumberField,
  ProblemNotice,
  ScreenHeader,
  Switch,
  SymbolIcon,
  TextField,
} from "@/shared/ui";
import type { SymbolName } from "@/shared/kernel/style";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { SpaceDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { safeReturnTo } from "@/shared/ui/navigation/auth-redirect";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { currencyOf } from "@/shared/ui/format/currencies";
import { formatNumber, type Formats } from "@/shared/ui/format/formatters";
import type { NumberRule } from "@/shared/ui/format/number-input";
import {
  accountBodyOf,
  accountFieldOf,
  FIELDS_BY_TYPE,
  OWED_TYPES,
  PERSONAL_TYPES,
  SWITCH_DEFAULTS,
  type AccountField,
} from "./account-fields";
import type { AccountType } from "./account-look";

/** The type grid's icons: each type's default (the API's `iconOf`, P50). */
const TYPE_ICONS = {
  CASH: "cash",
  BANK: "bank",
  WALLET: "wallet",
  CREDIT_CARD: "card",
  SAVINGS: "piggy",
  INVESTMENT: "trend",
  LOAN: "coins",
  OTHER: "dots",
  SHARED_FUND: "users",
} as const satisfies Record<AccountType, SymbolName>;
/** Issue #164: how each number attribute is typed, and the example under it (as a decimal) when the kind's is not apt. */
const NUMBER_FIELDS: Partial<
  Record<AccountField, Omit<NumberRule, "numberFormat"> & { example?: string; unit?: string }>
> = {
  lastFour: { kind: "digits", maxLength: 4 },
  creditLimit: { kind: "money" },
  principal: { kind: "money" },
  cutOffDay: { kind: "integer", maxLength: 2, example: "25" },
  paymentDay: { kind: "integer", maxLength: 2, example: "15" },
  termDays: { kind: "integer", example: "90" },
  termMonths: { kind: "integer", example: "36" },
  monthlyRate: { kind: "decimal", decimals: 4, example: "1.89", unit: "%" },
  annualRate: { kind: "decimal", decimals: 4, unit: "%" },
};
type Where = "name" | "opening" | AccountField;

/** HU-E9-03, the NewAccount artboard as a page: the type first, then only its attributes and the two switches. */
export function NewAccountForm({
  space,
  formats,
  returnTo,
  api: injected,
}: {
  readonly space: SpaceDto;
  readonly formats: Formats;
  /** The screen the flow started from; saving lands there. Anything but a same-origin path is ignored. */
  readonly returnTo?: string | null;
  readonly api?: Api;
}) {
  const t = useTranslations("accounts");
  const router = useRouter();
  const messageOf = useProblemMessage();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [type, setType] = useState<AccountType | "">("");
  const [name, setName] = useState("");
  const [opening, setOpening] = useState("");
  const [fields, setFields] = useState<Partial<Record<AccountField, string>>>({});
  const [available, setAvailable] = useState<boolean | null>(null);
  const [netWorth, setNetWorth] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [unreadable, setUnreadable] = useState<Where | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  const currency = currencyOf(space.currency);
  const types: readonly AccountType[] =
    space.kind === "SHARED" ? [...PERSONAL_TYPES, "SHARED_FUND"] : PERSONAL_TYPES;
  const where = problem ? accountFieldOf(problem) : null;
  const errorOf = (field: Where) =>
    unreadable === field
      ? t("amountUnreadable", { example: formatNumber("1500000", formats) })
      : where === field && problem
        ? messageOf(problem).message
        : undefined;

  // A field's error is about its last value: it goes as soon as that field changes, never waiting for the next save.
  const clear = (field: Where) => {
    if (unreadable === field) setUnreadable(null);
    if (problem && where === field) setProblem(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!type) return;
    const draft = { type, name, opening, fields, includeInAvailable: available, includeInNetWorth: netWorth };
    const built = accountBodyOf(draft, space.currency, formats.numberFormat);
    setProblem(null);
    if (!built.ok) {
      setUnreadable(built.field);
      return;
    }
    setUnreadable(null);
    setPending(true);
    try {
      const { error, response } = await api.POST("/api/v1/spaces/{spaceId}/accounts", {
        params: { path: { spaceId: space.id } },
        body: built.body as never,
      });
      if (response.ok) {
        router.replace(safeReturnTo(returnTo) ?? `/spaces/${space.id}/accounts`);
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
      <ScreenHeader backHref={`/spaces/${space.id}/accounts`} title={t("newTitle")} />
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-5">
        <ChoiceGroup
          label={t("field.type")}
          layout="grid"
          value={type}
          onValueChange={(next) => setType(next)}
          options={types.map((v) => ({
            value: v,
            label: (
              <span className="flex flex-col items-center gap-1 py-2">
                <SymbolIcon name={TYPE_ICONS[v]} size={22} />
                <span className="text-xs">{t(`type.${v}`)}</span>
              </span>
            ),
          }))}
        />
        {type ? (
          <>
            <TextField
              id="na-name"
              label={t("field.name")}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                clear("name");
              }}
              error={errorOf("name")}
              required
            />
            <NumberField
              id="na-opening"
              label={t(OWED_TYPES.includes(type) ? "field.owed" : "field.opening")}
              kind="money"
              numberFormat={formats.numberFormat}
              decimals={currency.exponent}
              symbol={currency.symbol}
              value={opening}
              onChange={(next) => {
                setOpening(next);
                clear("opening");
              }}
              error={errorOf("opening")}
            />
            {FIELDS_BY_TYPE[type].map((field) => {
              const number = NUMBER_FIELDS[field];
              const change = (next: string) => {
                setFields((all) => ({ ...all, [field]: next }));
                clear(field);
              };
              return number ? (
                <NumberField
                  key={field}
                  id={`na-${field}`}
                  label={t(`field.${field}`)}
                  {...number}
                  numberFormat={formats.numberFormat}
                  decimals={number.kind === "money" ? currency.exponent : number.decimals}
                  symbol={number.kind === "money" ? currency.symbol : undefined}
                  hint={field === "lastFour" ? t("field.lastFourHint") : undefined}
                  value={fields[field] ?? ""}
                  onChange={change}
                  error={errorOf(field)}
                />
              ) : (
                <TextField
                  key={field}
                  id={`na-${field}`}
                  label={t(`field.${field}`)}
                  type={field === "maturityDate" ? "date" : "text"}
                  value={fields[field] ?? ""}
                  onChange={(event) => change(event.target.value)}
                  error={errorOf(field)}
                />
              );
            })}
            <Switch
              id="na-available"
              label={t("switch.available")}
              description={t("switch.availableHint")}
              checked={available ?? SWITCH_DEFAULTS[type].includeInAvailable}
              onCheckedChange={setAvailable}
            />
            <Switch
              id="na-net-worth"
              label={t("switch.netWorth")}
              description={t("switch.netWorthHint")}
              checked={netWorth ?? SWITCH_DEFAULTS[type].includeInNetWorth}
              onCheckedChange={setNetWorth}
            />
            <p className="text-sm text-muted">{t("currency", { currency: space.currency })}</p>
          </>
        ) : null}
        {problem && where === "form" ? <ProblemNotice problem={problem} /> : null}
        <Button type="submit" size="lg" disabled={!type || pending}>
          {t("create")}
        </Button>
      </form>
    </div>
  );
}
