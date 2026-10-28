import { ensurer, type Load } from "../load";
import { accountListQuery, accountQuery, categoriesQuery } from "../reads";

// Slice 3's loaders (ADR 0006): they load beside their screens, never with the app shell.

/** HU-E9-03: every account of the space with the totals, archived ones in their own section. */
export const loadAccounts = (load: Load, spaceId: string) =>
  ensurer(load)(accountListQuery(load.apis.api, spaceId, "all"));

/** Issue 169: one account for its edit form; one that is gone is not found. */
export const loadAccount = (load: Load, spaceId: string, accountId: string) =>
  ensurer(load)(accountQuery(load.apis.api, spaceId, accountId));

/** HU-E9-04: the whole category tree of the space, archived groups and categories included. */
export const loadCategories = (load: Load, spaceId: string) =>
  ensurer(load)(categoriesQuery(load.apis.api, spaceId, "all"));
