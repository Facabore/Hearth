import accountsEn from "./areas/accounts.en.json" with { type: "json" };
import accountsEs from "./areas/accounts.es.json" with { type: "json" };
import categoriesEn from "./areas/categories.en.json" with { type: "json" };
import categoriesEs from "./areas/categories.es.json" with { type: "json" };
import invitationEn from "./areas/invitation.en.json" with { type: "json" };
import invitationEs from "./areas/invitation.es.json" with { type: "json" };
import membersEn from "./areas/members.en.json" with { type: "json" };
import membersEs from "./areas/members.es.json" with { type: "json" };
import planEn from "./areas/plan.en.json" with { type: "json" };
import planEs from "./areas/plan.es.json" with { type: "json" };
import recurrencesEn from "./areas/recurrences.en.json" with { type: "json" };
import recurrencesEs from "./areas/recurrences.es.json" with { type: "json" };
import settingsEn from "./areas/settings.en.json" with { type: "json" };
import settingsEs from "./areas/settings.es.json" with { type: "json" };
import coreEn from "./en.json" with { type: "json" };
import coreEs from "./es.json" with { type: "json" };
import { mergeMessages } from "../merge";

/**
 * Ruling P276: each language's whole catalog, the core and every area merged, for the types (`global.d.ts`) and the
 * tests. The app never imports it: it loads the core, then each area with its routes (`src/spa/i18n.tsx`).
 */
export const es = mergeMessages(
  coreEs,
  planEs,
  recurrencesEs,
  categoriesEs,
  membersEs,
  accountsEs,
  settingsEs,
  invitationEs,
) as typeof coreEs &
  typeof planEs &
  typeof recurrencesEs &
  typeof categoriesEs &
  typeof membersEs &
  typeof accountsEs &
  typeof settingsEs &
  typeof invitationEs;

export const en = mergeMessages(
  coreEn,
  planEn,
  recurrencesEn,
  categoriesEn,
  membersEn,
  accountsEn,
  settingsEn,
  invitationEn,
) as typeof es;
