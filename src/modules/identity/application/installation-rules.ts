import type { InstallationRules } from "../domain/preferences";

/**
 * HU-E1-15: where the installation's defaults and locks come from. `BuiltInInstallationRules` answers es-CO's formats
 * and no lock; HU-E8-18 binds an adapter of the stored rules in the composition root, and nothing else changes.
 */
export interface InstallationRulesReader {
  rules(): Promise<InstallationRules>;
}
