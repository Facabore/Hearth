import { domainError, err, ok, parseTimeZone, type Result } from "@/shared/kernel";
import { matchCatalog } from "./category-match";
import {
  IMPORT_GROUP_NAME,
  type AccountMapping,
  type CategoryMapping,
  type ImportMappings,
} from "./import-batch";
import type { SourceSnapshot } from "./source-snapshot";

/** One of the importing person's accounts in the space, archived ones included. */
export interface HearthAccount {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly archived: boolean;
}

export interface HearthCategoryGroup {
  readonly id: string;
  readonly name: string;
  /** The catalog key of a seeded group (D11), such as "other"; null for a group someone created. */
  readonly key: string | null;
  readonly archived: boolean;
}

export interface HearthCategory {
  readonly id: string;
  readonly groupId: string;
  readonly parentCategoryId: string | null;
  readonly name: string;
  /** The catalog key of a seeded category (D11, P330); null for one someone created. */
  readonly key: string | null;
  readonly archived: boolean;
}

export interface HearthTargets {
  readonly accounts: readonly HearthAccount[];
  readonly groups: readonly HearthCategoryGroup[];
  readonly categories: readonly HearthCategory[];
}

/**
 * What earlier imports of this source linked each source id to (design §3.3): `accounts` and `categories` by imports
 * that still stand, `undoneAccounts` and `undoneCategories` by imports that were undone, whose archived records a
 * re-import restores.
 */
export interface PriorLinks {
  readonly accounts: ReadonlyMap<string, string>;
  readonly categories: ReadonlyMap<string, string>;
  readonly undoneAccounts: ReadonlyMap<string, string>;
  readonly undoneCategories: ReadonlyMap<string, string>;
}

/** The longest account or category name Hearth takes (the accounts and categories domains). */
const MAX_NAME = 60;
const SUFFIX = " (Money Manager)";

const key = (name: string): string => name.trim().toLowerCase();

/**
 * `desired`, or, when a record in its scope already holds that name (ignoring case, archived ones included, as the
 * accounts and categories modules count them), "`desired` (Money Manager)", then "… 2", "… 3": a name no record of
 * the scope holds, at most `MAX_NAME` characters.
 */
export const freeName = (desired: string, taken: ReadonlySet<string>): string => {
  const name = desired.trim();
  if (!taken.has(key(name))) return name;
  for (let n = 1; ; n += 1) {
    const tail = n === 1 ? SUFFIX : `${SUFFIX} ${n}`;
    const candidate = `${name.slice(0, MAX_NAME - tail.length).trimEnd()}${tail}`;
    if (!taken.has(key(candidate))) return candidate;
  }
};

/** The group a new top-level category goes to by default: Otros (design §2.2), else the first live group, else null. */
export const defaultGroupId = (groups: readonly HearthCategoryGroup[]): string | null => {
  const live = groups.filter((g) => !g.archived);
  return (live.find((g) => g.key === "other") ?? live[0])?.id ?? null;
};

/** The live group `IMPORT_GROUP_NAME` names, which a confirm reuses before creating it. */
export const importGroupOf = (groups: readonly HearthCategoryGroup[]): HearthCategoryGroup | undefined =>
  groups.find((g) => !g.archived && key(g.name) === key(IMPORT_GROUP_NAME));

/**
 * What a link points at, when it can be used as is: a live record of the right kind, or an archived one an undone
 * import of this source created (the confirm restores it).
 */
const linkedTarget = <T extends { readonly id: string; readonly archived: boolean }>(
  records: readonly T[],
  live: string | undefined,
  undone: string | undefined,
  fits: (record: T) => boolean,
): T | undefined => {
  const linked = records.find((r) => r.id === live && !r.archived && fits(r));
  return linked ?? records.find((r) => r.id === undone && fits(r));
};

/**
 * Settles every new account's and category's name in the order of the snapshot (design §3.3): each one gets a name no
 * record of its scope holds, archived ones included, so a confirm never collides on a name. An account's scope is
 * the space; a top-level category's, its group's top-level categories; a subcategory's, the children of what its
 * parent maps to. A subcategory whose parent maps to a subcategory merges into it (D20 has three levels) and needs
 * no name.
 */
const withFreeNames = (
  snapshot: SourceSnapshot,
  mappings: ImportMappings,
  targets: HearthTargets,
): ImportMappings => {
  const takenAccounts = new Set(targets.accounts.map((a) => key(a.name)));
  const accounts: Record<string, AccountMapping> = {};
  for (const account of snapshot.accounts) {
    const mapping = mappings.accounts[account.sourceId];
    if (mapping === undefined) continue;
    if (mapping.kind === "new") {
      const name = freeName(mapping.name ?? account.name, takenAccounts);
      takenAccounts.add(key(name));
      accounts[account.sourceId] = { ...mapping, name };
    } else accounts[account.sourceId] = mapping;
  }

  const scopes = new Map<string, Set<string>>();
  const scope = (id: string, initial: () => readonly string[]) =>
    scopes.get(id) ?? scopes.set(id, new Set(initial().map(key))).get(id)!;
  const importGroup = importGroupOf(targets.groups);
  const childrenOf = (groupId: string | null, parentId: string | null) =>
    targets.categories
      .filter((c) => c.parentCategoryId === parentId && (parentId !== null || c.groupId === groupId))
      .map((c) => c.name);
  const categories: Record<string, CategoryMapping> = {};
  const ordered = [
    ...snapshot.categories.filter((c) => c.parentSourceId === null),
    ...snapshot.categories.filter((c) => c.parentSourceId !== null),
  ];
  for (const category of ordered) {
    const mapping = mappings.categories[category.sourceId];
    if (mapping === undefined) continue;
    if (mapping.kind === "existing") {
      categories[category.sourceId] = mapping;
      continue;
    }
    let taken: Set<string>;
    if (category.parentSourceId === null) {
      const groupId = mapping.groupId ?? importGroup?.id ?? null;
      taken = scope(`group:${groupId ?? "import"}`, () =>
        groupId === null ? [] : childrenOf(groupId, null),
      );
    } else {
      const parent = categories[category.parentSourceId];
      const parentTarget =
        parent?.kind === "existing" ? targets.categories.find((c) => c.id === parent.categoryId) : undefined;
      if (parentTarget?.parentCategoryId != null) {
        categories[category.sourceId] = { kind: "new", groupId: null };
        continue;
      }
      taken =
        parentTarget === undefined
          ? scope(`new:${category.parentSourceId}`, () => [])
          : scope(`parent:${parentTarget.id}`, () => childrenOf(null, parentTarget.id));
    }
    const name = freeName(mapping.name ?? category.name, taken);
    taken.add(key(name));
    categories[category.sourceId] = {
      kind: "new",
      groupId: category.parentSourceId === null ? mapping.groupId : null,
      name,
    };
  }
  return { ...mappings, accounts, categories };
};

/**
 * The mappings an upload starts with (design §2.1, §2.2, §3.3), each one confirmable as proposed and each one the
 * person may change before confirming:
 *
 * - An account goes to what an earlier import of this source linked it to (live, or archived by an undo, which the
 *   confirm restores) in the same currency, else to a live account of the person's with the same name and currency,
 *   else to a new account of the source's type and currency, under a name no account of the space holds.
 * - A top-level category goes to its linked category (the same way), else the catalog category its name matches (when
 *   the space has it live), else a live top-level category of the same name, else a new one in Otros (or in the
 *   import's own group when the space has no live group).
 * - A subcategory goes to its linked category, else a live subcategory of the same name under what its parent maps to
 *   (design §2.2's merge), else a new subcategory there.
 */
export const proposeMappings = (
  snapshot: SourceSnapshot,
  targets: HearthTargets,
  links: PriorLinks,
  timeZone: string,
): ImportMappings => {
  const liveAccounts = targets.accounts.filter((a) => !a.archived);
  const liveCategories = targets.categories.filter((c) => !c.archived);
  const sameName = (a: string, b: string) => key(a) === key(b);

  const accounts: Record<string, AccountMapping> = {};
  for (const account of snapshot.accounts) {
    const fits = (a: HearthAccount) => a.currency === account.currency;
    const target =
      linkedTarget(
        targets.accounts,
        links.accounts.get(account.sourceId),
        links.undoneAccounts.get(account.sourceId),
        fits,
      ) ?? liveAccounts.find((a) => sameName(a.name, account.name) && fits(a));
    accounts[account.sourceId] =
      target === undefined
        ? { kind: "new", type: account.type, currency: account.currency }
        : { kind: "existing", accountId: target.id };
  }

  const categories: Record<string, CategoryMapping> = {};
  const otros = defaultGroupId(targets.groups);
  const linkedCategory = (sourceId: string) =>
    linkedTarget(
      targets.categories,
      links.categories.get(sourceId),
      links.undoneCategories.get(sourceId),
      () => true,
    );
  for (const category of snapshot.categories.filter((c) => c.parentSourceId === null)) {
    const match = matchCatalog(category.name, category.kind);
    const target =
      linkedCategory(category.sourceId) ??
      (match.kind === "catalog" ? liveCategories.find((c) => c.key === match.catalogKey) : undefined) ??
      liveCategories.find((c) => c.parentCategoryId === null && sameName(c.name, category.name));
    categories[category.sourceId] =
      target === undefined ? { kind: "new", groupId: otros } : { kind: "existing", categoryId: target.id };
  }
  for (const category of snapshot.categories.filter((c) => c.parentSourceId !== null)) {
    const parent = categories[category.parentSourceId!];
    const parentId = parent?.kind === "existing" ? parent.categoryId : undefined;
    const target =
      linkedCategory(category.sourceId) ??
      (parentId === undefined
        ? undefined
        : liveCategories.find((c) => c.parentCategoryId === parentId && sameName(c.name, category.name)));
    categories[category.sourceId] =
      target === undefined ? { kind: "new", groupId: null } : { kind: "existing", categoryId: target.id };
  }

  return withFreeNames(snapshot, { timeZone, accounts, categories, includeDuplicates: [] }, targets);
};

const invalidMapping = (reason: string, sourceId: string) =>
  err(domainError("InvalidImportMapping", { reason, sourceId }));

/**
 * The mappings a confirm may use (design §3.2), checked against the snapshot and what Hearth holds now, with every new
 * account's and category's name settled (`withFreeNames`): `InvalidImportMapping` with a `reason` and the `sourceId`
 * it is about, or `InvalidTimeZone`.
 *
 * - Every key names a source account, category or movement (`unknownSource`), and every source account and category
 *   has a mapping (`mappingRequired`): nothing reaches the ledger without a target.
 * - An existing account is one of the person's live accounts, or an archived one an undone import of this source
 *   created (`accountNotFound`), in the source account's currency, and so is a new one (`currencyMismatch`): the
 *   file's amounts are in that currency (D29).
 * - An existing category is a live category of the space, or an archived one an undone import of this source created
 *   (`categoryNotFound`); a new top-level category names a live group, or none for the import's own group
 *   (`groupNotFound`); a new subcategory goes under its parent's target, so its group is dropped.
 */
export const checkMappings = (
  snapshot: SourceSnapshot,
  mappings: ImportMappings,
  targets: HearthTargets,
  links: PriorLinks,
): Result<ImportMappings> => {
  const zone = parseTimeZone(mappings.timeZone);
  if (!zone.ok) return zone;
  const sources = new Map(snapshot.accounts.map((a) => [a.sourceId, a]));
  for (const sourceId of Object.keys(mappings.accounts)) {
    if (!sources.has(sourceId)) return invalidMapping("unknownSource", sourceId);
  }
  for (const source of snapshot.accounts) {
    const mapping = mappings.accounts[source.sourceId];
    if (mapping === undefined) return invalidMapping("mappingRequired", source.sourceId);
    if (mapping.kind === "existing") {
      const target = targets.accounts.find(
        (a) =>
          a.id === mapping.accountId && (!a.archived || links.undoneAccounts.get(source.sourceId) === a.id),
      );
      if (target === undefined) return invalidMapping("accountNotFound", source.sourceId);
      if (target.currency !== source.currency) return invalidMapping("currencyMismatch", source.sourceId);
    } else if (mapping.currency !== source.currency) {
      return invalidMapping("currencyMismatch", source.sourceId);
    }
  }
  const categorySources = new Map(snapshot.categories.map((c) => [c.sourceId, c]));
  for (const sourceId of Object.keys(mappings.categories)) {
    if (!categorySources.has(sourceId)) return invalidMapping("unknownSource", sourceId);
  }
  for (const source of snapshot.categories) {
    const mapping = mappings.categories[source.sourceId];
    if (mapping === undefined) return invalidMapping("mappingRequired", source.sourceId);
    if (mapping.kind === "existing") {
      const usable = targets.categories.some(
        (c) =>
          c.id === mapping.categoryId &&
          (!c.archived || links.undoneCategories.get(source.sourceId) === c.id),
      );
      if (!usable) return invalidMapping("categoryNotFound", source.sourceId);
    } else if (
      source.parentSourceId === null &&
      mapping.groupId !== null &&
      !targets.groups.some((g) => g.id === mapping.groupId && !g.archived)
    ) {
      return invalidMapping("groupNotFound", source.sourceId);
    }
  }
  const movementKeys = new Set(snapshot.movements.map((m) => m.sourceKey));
  const unknown = mappings.includeDuplicates.find((k) => !movementKeys.has(k));
  if (unknown !== undefined) return invalidMapping("unknownSource", unknown);
  return ok(withFreeNames(snapshot, { ...mappings, timeZone: zone.value }, targets));
};
