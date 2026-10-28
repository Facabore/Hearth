// next-intl's client API is use-intl's (ADR 0006): the components keep `useTranslations` and the catalogs unchanged.
export {
  IntlProvider as NextIntlClientProvider,
  useFormatter,
  useLocale,
  useMessages,
  useNow,
  useTimeZone,
  useTranslations,
} from "use-intl";
