import {
  domainError,
  err,
  ok,
  todayIn,
  type Clock,
  type PeriodPolicy,
  type Result,
  type UserTimeZones,
} from "@/shared/kernel";
import { exportTables } from "../domain/export-csv";
import { exportDocument, type ExportDocument } from "../domain/export-document";
import type {
  ExportAccountSource,
  ExportGroupSource,
  ExportMemberSource,
  ExportMovementSource,
  ExportPlanSource,
  ExportRecurrenceSource,
  ExportSpaceSource,
} from "../domain/export-source";

/** A space the person currently belongs to, as the spaces module lists it (archived ones included). */
export interface ExportSpaceSummary {
  readonly id: string;
  readonly name: string;
  readonly kind: ExportSpaceSource["kind"];
  readonly currency: string;
  readonly periodPolicy: PeriodPolicy;
  readonly role: string | null;
  readonly archived: boolean;
}

/**
 * Design §3.6: what the export reads, through the other modules' own use cases. Every read is for one space the person
 * belongs to and answers what that person may read there. `members` is read first, and nothing else of a space is read
 * unless it succeeded; `movements`, which reads the ledger's own query (it checks nothing), checks the caller's access
 * again itself, so it never depends on that order.
 */
export interface ExportReader {
  spacesOf(userId: string): Promise<Result<readonly ExportSpaceSummary[]>>;
  /** Every member row of the space, former members included (D15); refused for anyone who may not read the space. */
  members(spaceId: string, userId: string): Promise<Result<readonly ExportMemberSource[]>>;
  accounts(spaceId: string, userId: string): Promise<Result<readonly ExportAccountSource[]>>;
  categories(spaceId: string, userId: string): Promise<Result<readonly ExportGroupSource[]>>;
  movements(spaceId: string, userId: string): Promise<Result<readonly ExportMovementSource[]>>;
  recurrences(spaceId: string, userId: string): Promise<Result<readonly ExportRecurrenceSource[]>>;
  plans(spaceId: string, userId: string): Promise<Result<readonly ExportPlanSource[]>>;
}

/** Writes the CSV files into one archive (a stored ZIP, design §3.6). */
export type Archiver = (
  files: readonly { readonly name: string; readonly data: Uint8Array }[],
  modifiedAt: Date,
) => Uint8Array;

/** Design §3.6: exports are heavy reads, so each person gets a few per window; false means "refuse with 429". */
export interface ExportThrottle {
  allows(userId: string): boolean;
}

export interface ExportDeps {
  readonly reader: ExportReader;
  readonly archive: Archiver;
  readonly throttle: ExportThrottle;
  readonly clock: Clock;
  readonly userTimeZones: UserTimeZones;
}

export type ExportFormat = "json" | "csv";

export interface ExportPersonDataInput {
  readonly user: { readonly id: string; readonly name: string; readonly locale: string };
  readonly format: ExportFormat;
  /** Only this space, which must be one of the person's current spaces; every one of them when absent. */
  readonly spaceId?: string;
}

/** The file to hand over: its name, dated in the person's zone, and its content. */
export type ExportFile =
  | { readonly format: "json"; readonly filename: string; readonly document: ExportDocument }
  | { readonly format: "csv"; readonly filename: string; readonly archive: Uint8Array };

export type ExportPersonData = (input: ExportPersonDataInput) => Promise<Result<ExportFile>>;

const sourceOf = async (
  reader: ExportReader,
  space: ExportSpaceSummary,
  userId: string,
): Promise<Result<ExportSpaceSource>> => {
  // Members first: it authorizes the read, so nothing else of a space is read for someone who may not see it.
  const members = await reader.members(space.id, userId);
  if (!members.ok) return members;
  const [accounts, categoryGroups, movements, recurrences, plans] = await Promise.all([
    reader.accounts(space.id, userId),
    reader.categories(space.id, userId),
    reader.movements(space.id, userId),
    reader.recurrences(space.id, userId),
    reader.plans(space.id, userId),
  ]);
  if (!accounts.ok) return accounts;
  if (!categoryGroups.ok) return categoryGroups;
  if (!movements.ok) return movements;
  if (!recurrences.ok) return recurrences;
  if (!plans.ok) return plans;
  return ok({
    ...space,
    members: members.value,
    accounts: accounts.value,
    categoryGroups: categoryGroups.value,
    movements: movements.value,
    recurrences: recurrences.value,
    plans: plans.value,
  });
};

const encoder = new TextEncoder();

/**
 * Design §3.6, D28: everything the person can see in Hearth and nothing more. Their personal space and each shared or
 * direct space they currently belong to (or only `spaceId`, which must be one of them: any other id is
 * SpaceNotFound, as on every other route). Another member's personal account never appears (D9): a payment from it
 * shows only who paid. Rate-limited per person; the content never reaches a log.
 */
export const createExportPersonData =
  (deps: ExportDeps): ExportPersonData =>
  async ({ user, format, spaceId }) => {
    const listed = await deps.reader.spacesOf(user.id);
    if (!listed.ok) return listed;
    const current = listed.value;
    const chosen = spaceId === undefined ? current : current.filter((s) => s.id === spaceId);
    if (chosen.length === 0) return err(domainError("SpaceNotFound"));
    // Counted once the space is known to be the person's: a refused id costs no export.
    if (!deps.throttle.allows(user.id)) return err(domainError("TooManyRequests"));
    const personal = current.find((s) => s.kind === "PERSONAL");
    // The person's own accounts name their payments in every space, even when only a shared one is exported.
    const yourAccounts = personal === undefined ? ok([]) : await deps.reader.accounts(personal.id, user.id);
    if (!yourAccounts.ok) return yourAccounts;
    const spaces: ExportSpaceSource[] = [];
    for (const space of chosen) {
      const source = await sourceOf(deps.reader, space, user.id);
      if (!source.ok) return source;
      spaces.push(source.value);
    }
    const timeZone = await deps.userTimeZones.timeZoneOf(user.id);
    const exportedAt = deps.clock.now();
    const document = exportDocument({
      person: { name: user.name, locale: user.locale, timeZone },
      exportedAt,
      spaces,
      yourAccounts: yourAccounts.value,
    });
    const day = todayIn(deps.clock, timeZone);
    if (format === "json") return ok({ format, filename: `hearth-export-${day}.json`, document });
    const tables = exportTables(document);
    const archive = deps.archive(
      [
        { name: "movements.csv", data: encoder.encode(tables.movements) },
        { name: "accounts.csv", data: encoder.encode(tables.accounts) },
        { name: "categories.csv", data: encoder.encode(tables.categories) },
      ],
      exportedAt,
    );
    return ok({ format, filename: `hearth-export-${day}.zip`, archive });
  };
