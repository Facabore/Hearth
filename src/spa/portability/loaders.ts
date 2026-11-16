import { personalSpaceOf } from "@/modules/spaces/ui";
import { ensurer, type Load } from "../load";
import { spacesQuery } from "../queries";
import { accountListQuery, categoriesQuery } from "../reads";
import { importHistoryQuery, importPreviewQuery } from "./queries";

/** D28: an import goes into the person's personal space whatever space Más was opened in (design §3.2). */
export const personalIdOf = async (load: Load): Promise<string> =>
  personalSpaceOf(await load.queryClient.ensureQueryData(spacesQuery(load.apis.api))).id;

/** Importar y exportar: the personal space's past imports. */
export const loadImportHub = async (load: Load) =>
  ensurer(load)(importHistoryQuery(load.apis.api, await personalIdOf(load)));

/** A draft's review: its preview. */
export const loadImportReview = async (load: Load, importId: string) =>
  ensurer(load)(importPreviewQuery(load.apis.api, await personalIdOf(load), importId));

/** A draft's accounts: its preview and the person's live accounts to map them to. */
export const loadImportAccounts = async (load: Load, importId: string) => {
  const spaceId = await personalIdOf(load);
  const ensure = ensurer(load);
  await Promise.all([
    ensure(importPreviewQuery(load.apis.api, spaceId, importId)),
    ensure(accountListQuery(load.apis.api, spaceId, "active")),
  ]);
};

/** A draft's categories: its preview and the personal space's category tree. */
export const loadImportCategories = async (load: Load, importId: string) => {
  const spaceId = await personalIdOf(load);
  const ensure = ensurer(load);
  await Promise.all([
    ensure(importPreviewQuery(load.apis.api, spaceId, importId)),
    ensure(categoriesQuery(load.apis.api, spaceId, "active")),
  ]);
};
