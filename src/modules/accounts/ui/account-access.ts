import { controlsFor } from "@/modules/spaces/ui";
import type { SpaceDto } from "@/shared/ui/api/dto";

/**
 * Who creates and edits a space's accounts: anyone in their personal space; in a shared space only an OWNER or ADMIN,
 * who manages its funds; a direct space has none. Its own module, so an account's screen (P327) checks it without
 * loading Cuentas.
 */
export const canManageAccounts = (kind: SpaceDto["kind"], role: SpaceDto["role"]): boolean =>
  kind === "PERSONAL" || (kind === "SHARED" && controlsFor(role, kind).manageFunds);
