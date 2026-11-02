import { personalSpaceOf } from "@/modules/spaces/ui";
import { ensurer, sharedSpace, viewerOf, type Load } from "../load";
import { accountsQuery, categoriesQuery, membersQuery, type Archived } from "../reads";
import { recurrenceQuery, recurrencesQuery, upcomingQuery } from "./queries";

// HU-E9-09's loaders (ADR 0006): they load beside their screens, never with the app shell.

/**
 * What names a recurrence's payer and accounts: the space's accounts and, in a shared or direct space, its members and
 * the person's own personal accounts, which pay there (P168).
 */
const loadNames = async (load: Load, spaceId: string, archived: Archived) => {
  const ensure = ensurer(load);
  const { api } = load.apis;
  const viewer = await viewerOf(load, spaceId);
  await Promise.all([
    ensure(accountsQuery(api, spaceId, archived)),
    ensure(categoriesQuery(api, spaceId, archived)),
    // Every space: the person's member id is who pays a personal expense.
    ensure(membersQuery(api, spaceId)),
    viewer && sharedSpace(viewer.space)
      ? ensure(accountsQuery(api, personalSpaceOf(viewer.spaces).id, archived))
      : undefined,
  ]);
};

/** P270's list: every recurrence of the space, with what names their rows. */
export const loadRecurrences = async (load: Load, spaceId: string) => {
  await Promise.all([
    ensurer(load)(recurrencesQuery(load.apis.api, spaceId)),
    loadNames(load, spaceId, "all"),
  ]);
};

/** The form: the active accounts and categories it offers, and who may pay. */
export const loadRecurrenceForm = (load: Load, spaceId: string) => loadNames(load, spaceId, "active");

/** The detail: the recurrence and its next dates, from the API; one that is gone is not found. */
export const loadRecurrence = async (load: Load, spaceId: string, recurrenceId: string) => {
  const ensure = ensurer(load);
  const { api } = load.apis;
  await Promise.all([
    ensure(recurrenceQuery(api, spaceId, recurrenceId)),
    ensure(upcomingQuery(api, spaceId, recurrenceId)),
    loadNames(load, spaceId, "all"),
  ]);
};

/** The edit form: the recurrence, and every category, an archived one it still uses included. */
export const loadRecurrenceEdit = async (load: Load, spaceId: string, recurrenceId: string) => {
  const ensure = ensurer(load);
  await Promise.all([
    ensure(recurrenceQuery(load.apis.api, spaceId, recurrenceId)),
    ensure(categoriesQuery(load.apis.api, spaceId, "all")),
    loadNames(load, spaceId, "active"),
  ]);
};
