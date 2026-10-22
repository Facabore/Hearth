import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// The catalogs are compiled at build time (`precompile`): the client then ships only the small formatter, not the
// ICU message parser (ruling P134, about 12 KiB of script on every route).
const withNextIntl = createNextIntlPlugin({
  requestConfig: "./src/i18n/request.ts",
  experimental: {
    messages: {
      path: "./src/i18n/messages",
      format: "json",
      locales: "infer",
      sourceLocale: "es",
      precompile: true,
    },
  },
});

export default withNextIntl({
  output: "standalone",
  poweredByHeader: false,
} satisfies NextConfig);
