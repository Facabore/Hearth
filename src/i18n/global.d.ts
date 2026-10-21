import type messages from "./messages/es.json";
import type { Locale } from "./locale";

// Typed keys: a message used in code but missing from es.json fails `tsc --noEmit`.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
