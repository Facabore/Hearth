"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState, type FormEvent } from "react";
import {
  Button,
  ChoiceGroup,
  NumberField,
  ProblemNotice,
  Sheet,
  Switch,
  SymbolIcon,
  TextField,
} from "@/shared/ui";
import type { SymbolName } from "@/shared/kernel/style";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { SpaceDto } from "@/shared/ui/api/dto";
import { problemFrom } from "@/shared/ui/api/problem";
import { safeReturnTo } from "@/shared/ui/navigation/auth-redirect";
import { currencyOf } from "@/shared/ui/format/currencies";
import type { Formats } from "@/shared/ui/format/formatters";
import { AccountAttributeFields } from "./account-attribute-fields";
import {
  accountBodyOf,
  OWED_TYPES,
  PERSONAL_TYPES,
  SWITCH_DEFAULTS,
  type AccountField,
} from "./account-fields";
import type { AccountType } from "./account-look";
import { useAccountErrors } from "./use-account-errors";

/** The type grid's icons: each type's default (the API's `iconOf`, P50), but a loan draws board B1 · 08's bank (P292). */
const TYPE_ICONS = {
  CASH: "cash",
  BANK: "bank",
  WALLET: "wallet",
  CREDIT_CARD: "card",
  SAVINGS: "piggy",
  INVESTMENT: "trend",
  LOAN: "bank",
  OTHER: "dots",
  SHARED_FUND: "users",
} as const satisfies Record<AccountType, SymbolName>;

/**
 * HU-E9-03, the NewAccount artboard (board B1 · 08, P292): a sheet over Cuentas at the same address, the type first,
 * then only its attributes and the two switches, and Crear cuenta anchored in the footer. Closing it returns to Cuentas.
 */
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
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const formId = useId();
  const [type, setType] = useState<AccountType | "">("");
  const [name, setName] = useState("");
  const [opening, setOpening] = useState("");
  const [fields, setFields] = useState<Partial<Record<AccountField, string>>>({});
  const [available, setAvailable] = useState<boolean | null>(null);
  const [netWorth, setNetWorth] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const { problem, setProblem, setUnreadable, where, errorOf, clear } = useAccountErrors(formats);

  const currency = currencyOf(space.currency);
  const types: readonly AccountType[] =
    space.kind === "SHARED" ? [...PERSONAL_TYPES, "SHARED_FUND"] : PERSONAL_TYPES;

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
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) router.push(`/spaces/${space.id}/accounts`);
      }}
      title={t("newTitle")}
      closeButton={false}
      footer={
        <Button type="submit" form={formId} size="lg" className="w-full" disabled={!type || pending}>
          {t("create")}
        </Button>
      }
    >
      <form
        id={formId}
        aria-label={t("newTitle")}
        onSubmit={(event) => void submit(event)}
        noValidate
        className="flex flex-col gap-3"
      >
        <ChoiceGroup
          label={t("field.type")}
          layout="grid"
          value={type}
          onValueChange={(next) => setType(next)}
          options={types.map((v) => ({
            value: v,
            label: (
              <span data-icon={TYPE_ICONS[v]} className="flex flex-col items-center gap-1 py-2">
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
            <AccountAttributeFields
              type={type}
              idPrefix="na"
              formats={formats}
              currency={space.currency}
              values={fields}
              onChange={(field, next) => {
                setFields((all) => ({ ...all, [field]: next }));
                clear(field);
              }}
              errorOf={errorOf}
            />
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
      </form>
    </Sheet>
  );
}
