import { redirect } from "@tanstack/react-router";
import { personalSpaceOf } from "@/modules/spaces/ui";
import { ensurer, type Load } from "../load";
import { spacesQuery } from "../queries";
import { ProblemError } from "../read";
import { accountListQuery, categoriesQuery } from "../reads";
import { importHistoryQuery, importPreviewQuery } from "./queries";

/** D28: an import goes into the person's personal space whatever space Más was opened in (design §3.2). */
export const personalIdOf = async (load: Load): Promise<string> =>
  personalSpaceOf(await load.queryClient.ensureQueryData(spacesQuery(load.apis.api))).id;

/** Importar y exportar: the personal space's past imports. */
export const loadImportHub = async (load: Load) =>
  ensurer(load)(importHistoryQuery(load.apis.api, await personalIdOf(load)));

/** Where a draft's screens are, under the space of the URL (their way back). */
export interface DraftAt {
  readonly spaceId: string;
  readonly importId: string;
}

/**
 * A draft's preview. One that is no longer a draft (confirmed here or on another device, or undone) has nothing to
 * review: its screens open what it did instead (ImportNotDraft). One that is not the person's is not found (N1).
 */
const ensurePreview = async (load: Load, personalId: string, { spaceId, importId }: DraftAt) => {
  try {
    await ensurer(load)(importPreviewQuery(load.apis.api, personalId, importId));
  } catch (error) {
    if (error instanceof ProblemError && error.problem.code === "ImportNotDraft") {
      throw redirect({ href: `/spaces/${spaceId}/data/imports/${importId}/done`, replace: true });
    }
    throw error;
  }
};

/** A draft's review: its preview. */
export const loadImportReview = async (load: Load, at: DraftAt) =>
  ensurePreview(load, await personalIdOf(load), at);

/** A draft's accounts: its preview and the person's accounts, archived ones too (an undone import's, restored). */
export const loadImportAccounts = async (load: Load, at: DraftAt) => {
  const personalId = await personalIdOf(load);
  await Promise.all([
    ensurePreview(load, personalId, at),
    ensurer(load)(accountListQuery(load.apis.api, personalId, "all")),
  ]);
};

/** A draft's categories: its preview and the personal space's category tree, archived ones too. */
export const loadImportCategories = async (load: Load, at: DraftAt) => {
  const personalId = await personalIdOf(load);
  await Promise.all([
    ensurePreview(load, personalId, at),
    ensurer(load)(categoriesQuery(load.apis.api, personalId, "all")),
  ]);
};
