"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Badge,
  Button,
  ChoiceGroup,
  NumberField,
  ProblemNotice,
  ScreenHeader,
  Switch,
  SymbolIcon,
  TextField,
  VisuallyHidden,
} from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { AccountDto, SpaceDto } from "@/shared/ui/api/dto";
import { problemFrom } from "@/shared/ui/api/problem";
import { currencyOf } from "@/shared/ui/format/currencies";
import type { Formats } from "@/shared/ui/format/formatters";
import { AccountAttributeFields } from "./account-attribute-fields";
import { editBodyOf, editOf, OWED_TYPES, type AccountEdit } from "./account-fields";
import { ACCOUNT_ICON_CHOICES } from "./account-look";
import { useAccountErrors } from "./use-account-errors";

type Style = "icon" | "includeInAvailable" | "includeInNetWorth";

/**
 * Issue 169 with #120 (P253): "Predeterminado" while the value is stored as null, else "Restablecer", which stores null
 * again; the effective value then shows the type's default.
 */
function DefaultOrReset({ stored, label, onReset }: { stored: unknown; label: string; onReset: () => void }) {
  const t = useTranslations("common");
  return (
    <div className="flex h-11 items-center justify-end">
      {stored === null ? (
        <Badge>{t("default")}</Badge>
      ) : (
        <Button variant="ghost" size="compact" onClick={onReset}>
          {t("reset")} <VisuallyHidden>{label}</VisuallyHidden>
        </Button>
      )}
    </div>
  );
}

/**
 * Issue 169: edit an account's name, opening balance, icon, attributes and switches. The type never changes. Saving
 * sends only what changed (`PATCH`) and lands on the Accounts screen.
 */
export function EditAccountForm({
  space,
  account,
  formats,
  api: injected,
}: {
  readonly space: SpaceDto;
  readonly account: AccountDto;
  readonly formats: Formats;
  readonly api?: Api;
}) {
  const t = useTranslations("accounts");
  const router = useRouter();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const before = useMemo(() => editOf(account, formats.numberFormat), [account, formats.numberFormat]);
  const [edit, setEdit] = useState<AccountEdit>(before);
  const [pending, setPending] = useState(false);
  const { problem, setProblem, setUnreadable, where, errorOf, clear } = useAccountErrors(formats);

  const back = `/spaces/${space.id}/accounts`;
  const currency = currencyOf(space.currency);
  const style = (key: Style, value: AccountEdit[Style]) => setEdit((all) => ({ ...all, [key]: value }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const built = editBodyOf(account.type, before, edit, space.currency, formats.numberFormat);
    setProblem(null);
    if (!built.ok) {
      setUnreadable(built.field);
      return;
    }
    setUnreadable(null);
    if (Object.keys(built.body).length === 0) {
      router.replace(back);
      return;
    }
    setPending(true);
    try {
      const { error, response } = await api.PATCH("/api/v1/spaces/{spaceId}/accounts/{accountId}", {
        params: { path: { spaceId: space.id, accountId: account.id } },
        body: built.body as never,
      });
      if (response.ok) {
        router.replace(back);
        router.refresh();
        return;
      }
      setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };

  const styled = (key: Style, label: string, control: ReactNode) => (
    <div className="flex flex-col">
      {control}
      <DefaultOrReset stored={edit[key]} label={label} onReset={() => style(key, null)} />
    </div>
  );

  return (
    <div className="flex flex-col gap-5 py-4">
      <ScreenHeader backHref={back} title={t("edit.title")} />
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-5">
        <p className="text-sm text-muted">{t("edit.type", { type: t(`type.${account.type}`) })}</p>
        <TextField
          id="ea-name"
          label={t("field.name")}
          value={edit.name}
          onChange={(event) => {
            setEdit((all) => ({ ...all, name: event.target.value }));
            clear("name");
          }}
          error={errorOf("name")}
          required
        />
        <NumberField
          id="ea-opening"
          label={t(OWED_TYPES.includes(account.type) ? "field.owed" : "field.opening")}
          kind="money"
          numberFormat={formats.numberFormat}
          decimals={currency.exponent}
          symbol={currency.symbol}
          value={edit.opening}
          onChange={(next) => {
            setEdit((all) => ({ ...all, opening: next }));
            clear("opening");
          }}
          error={errorOf("opening")}
        />
        {styled(
          "icon",
          t("field.icon"),
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-ink">{t("field.icon")}</span>
            <ChoiceGroup
              label={t("field.icon")}
              layout="grid"
              value={edit.icon ?? account.defaults.icon}
              onValueChange={(next) => style("icon", next)}
              options={ACCOUNT_ICON_CHOICES.map((icon) => ({
                value: icon,
                label: (
                  <span className="flex min-h-11 items-center justify-center">
                    <SymbolIcon name={icon} size={22} />
                    <VisuallyHidden>{t(`icon.${icon}`)}</VisuallyHidden>
                  </span>
                ),
              }))}
            />
          </div>,
        )}
        <AccountAttributeFields
          type={account.type}
          idPrefix="ea"
          formats={formats}
          currency={space.currency}
          values={edit.fields}
          onChange={(field, next) => {
            setEdit((all) => ({ ...all, fields: { ...all.fields, [field]: next } }));
            clear(field);
          }}
          errorOf={errorOf}
        />
        {styled(
          "includeInAvailable",
          t("switch.available"),
          <Switch
            id="ea-available"
            label={t("switch.available")}
            description={t("switch.availableHint")}
            checked={edit.includeInAvailable ?? account.defaults.includeInAvailable}
            onCheckedChange={(next) => style("includeInAvailable", next)}
          />,
        )}
        {styled(
          "includeInNetWorth",
          t("switch.netWorth"),
          <Switch
            id="ea-net-worth"
            label={t("switch.netWorth")}
            description={t("switch.netWorthHint")}
            checked={edit.includeInNetWorth ?? account.defaults.includeInNetWorth}
            onCheckedChange={(next) => style("includeInNetWorth", next)}
          />,
        )}
        {problem && where === "form" ? <ProblemNotice problem={problem} /> : null}
        <Button type="submit" size="lg" disabled={pending}>
          {t("edit.save")}
        </Button>
      </form>
    </div>
  );
}
