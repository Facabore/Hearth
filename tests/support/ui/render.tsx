import { render, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import type { Locale } from "@/i18n/locale";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";

const CATALOGS = { es, en } as const;

/** The intl provider a component gets in the app, with `locale`'s catalog; a missing message throws. */
export const IntlWrapper = (locale: Locale) =>
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <NextIntlClientProvider
        locale={locale}
        messages={CATALOGS[locale]}
        timeZone="America/Bogota"
        onError={(error) => {
          throw error;
        }}
      >
        {children}
      </NextIntlClientProvider>
    );
  };

export const renderWithIntl = (ui: ReactElement, { locale = "es" }: { locale?: Locale } = {}): RenderResult =>
  render(ui, { wrapper: IntlWrapper(locale) });
