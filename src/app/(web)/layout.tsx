import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { THEME_BOOTSTRAP } from "@/shared/ui/theme/theme";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Hearth", template: "%s · Hearth" } };
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4ef" },
    { media: "(prefers-color-scheme: dark)", color: "#121614" },
  ],
};

/** The web UI's root (route group `(web)`; the API routes have no layout). */
export default async function WebLayout({ children }: { readonly children: ReactNode }) {
  const locale = await getLocale();
  return (
    // The bootstrap script sets data-theme before hydration, hence the suppressed warning on <html> only.
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
