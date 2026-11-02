import type { es } from "./messages/full";
import type { Locale } from "./locale";

// Typed keys over the whole catalog, the core and every area (ruling P276): a message used in code but missing from
// the Spanish files fails `tsc --noEmit`.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof es;
  }
}
