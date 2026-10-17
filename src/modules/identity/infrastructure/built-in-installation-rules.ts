import type { InstallationRulesReader } from "../application/installation-rules";
import { BUILT_IN_RULES, type InstallationRules } from "../domain/preferences";

/** HU-E1-15: the rules before HU-E8-18 stores them: es-CO's formats, nothing locked. */
export class BuiltInInstallationRules implements InstallationRulesReader {
  rules(): Promise<InstallationRules> {
    return Promise.resolve(BUILT_IN_RULES);
  }
}
