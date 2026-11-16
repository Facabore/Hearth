import { domainError, err, ok, parseTimeZone, type Result } from "@/shared/kernel";
import { matchCatalog } from "./category-match";
import type { AccountMapping, CategoryMapping, ImportMappings } from "./import-batch";
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

/** What earlier imports that were not undone linked each source id to (design §3.3). */
export interface PriorLinks {
  readonly accounts: ReadonlyMap<string, string>;
  readonly categories: ReadonlyMap<string, string>;
}

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The group a new top-level category goes to by default: Otros (design §2.2), else the first live group. */
export const defaultGroupId = (groups: readonly HearthCategoryGroup[]): string | null => {
  const live = groups.filter((g) => !g.archived);
  return (live.find((g) => g.key === "other") ?? live[0])?.id ?? null;
};

/**
 * The mappings an upload starts with (design §2.1, §2.2, §3.3), each one the person may change before confirming:
 *
 * - An account goes to the live account an earlier import linked it to, else to a live account of the person's with
 *   the same name and currency, else to a new account of the source's type and currency.
 * - A top-level category goes to its linked category, else the catalog category its name matches (when the space has
 *   it live), else a live top-level category of the same name, else a new one in Otros.
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
  const isLiveAccount = (id: string | undefined) => id !== undefined && liveAccounts.some((a) => a.id === id);
  const isLiveCategory = (id: string | undefined) =>
    id !== undefined && liveCategories.some((c) => c.id === id);

  const accounts: Record<string, AccountMapping> = {};
  for (const account of snapshot.accounts) {
    const linked = links.accounts.get(account.sourceId);
    const named = liveAccounts.find((a) => sameName(a.name, account.name) && a.currency === account.currency);
    accounts[account.sourceId] = isLiveAccount(linked)
      ? { kind: "existing", accountId: linked! }
      : named !== undefined
        ? { kind: "existing", accountId: named.id }
        : { kind: "new", type: account.type, currency: account.currency };
  }

  const categories: Record<string, CategoryMapping> = {};
  const otros = defaultGroupId(targets.groups);
  for (const category of snapshot.categories.filter((c) => c.parentSourceId === null)) {
    const linked = links.categories.get(category.sourceId);
    if (isLiveCategory(linked)) {
      categories[category.sourceId] = { kind: "existing", categoryId: linked! };
      continue;
    }
    const match = matchCatalog(category.name, category.kind);
    const catalog =
      match.kind === "catalog" ? liveCategories.find((c) => c.key === match.catalogKey) : undefined;
    const named = liveCategories.find((c) => c.parentCategoryId === null && sameName(c.name, category.name));
    const target = catalog ?? named;
    categories[category.sourceId] =
      target === undefined ? { kind: "new", groupId: otros } : { kind: "existing", categoryId: target.id };
  }
  for (const category of snapshot.categories.filter((c) => c.parentSourceId !== null)) {
    const linked = links.categories.get(category.sourceId);
    const parent = categories[category.parentSourceId!];
    const parentId = parent?.kind === "existing" ? parent.categoryId : undefined;
    const named =
      parentId === undefined
        ? undefined
        : liveCategories.find((c) => c.parentCategoryId === parentId && sameName(c.name, category.name));
    categories[category.sourceId] = isLiveCategory(linked)
      ? { kind: "existing", categoryId: linked! }
      : named !== undefined
        ? { kind: "existing", categoryId: named.id }
        : { kind: "new", groupId: null };
  }

  return { timeZone, accounts, categories, includeDuplicates: [] };
};

const invalidMapping = (reason: string, sourceId: string) =>
  err(domainError("InvalidImportMapping", { reason, sourceId }));

/**
 * The mappings a confirm may use (design §3.2), checked against the snapshot and what Hearth holds now:
 * `InvalidImportMapping` with a `reason` and the `sourceId` it is about, or `InvalidTimeZone`.
 *
 * - Every key names a source account, category or movement (`unknownSource`).
 * - An existing account is one of the person's live accounts (`accountNotFound`) in the source account's currency,
 *   and so is a new one (`currencyMismatch`): the file's amounts are in that currency (D29).
 * - An existing category is a live category of the space (`categoryNotFound`); a new top-level category names a
 *   live group (`groupNotFound`); a new subcategory goes under its parent's target, so its group is dropped.
 */
export const checkMappings = (
  snapshot: SourceSnapshot,
  mappings: ImportMappings,
  targets: HearthTargets,
): Result<ImportMappings> => {
  const zone = parseTimeZone(mappings.timeZone);
  if (!zone.ok) return zone;
  const sources = new Map(snapshot.accounts.map((a) => [a.sourceId, a]));
  for (const [sourceId, mapping] of Object.entries(mappings.accounts)) {
    const source = sources.get(sourceId);
    if (source === undefined) return invalidMapping("unknownSource", sourceId);
    if (mapping.kind === "existing") {
      const target = targets.accounts.find((a) => a.id === mapping.accountId && !a.archived);
      if (target === undefined) return invalidMapping("accountNotFound", sourceId);
      if (target.currency !== source.currency) return invalidMapping("currencyMismatch", sourceId);
    } else if (mapping.currency !== source.currency) {
      return invalidMapping("currencyMismatch", sourceId);
    }
  }
  const categorySources = new Map(snapshot.categories.map((c) => [c.sourceId, c]));
  const categories: Record<string, CategoryMapping> = {};
  for (const [sourceId, mapping] of Object.entries(mappings.categories)) {
    const source = categorySources.get(sourceId);
    if (source === undefined) return invalidMapping("unknownSource", sourceId);
    if (mapping.kind === "existing") {
      if (!targets.categories.some((c) => c.id === mapping.categoryId && !c.archived)) {
        return invalidMapping("categoryNotFound", sourceId);
      }
      categories[sourceId] = mapping;
    } else if (source.parentSourceId !== null) {
      categories[sourceId] = { kind: "new", groupId: null };
    } else {
      if (!targets.groups.some((g) => g.id === mapping.groupId && !g.archived)) {
        return invalidMapping("groupNotFound", sourceId);
      }
      categories[sourceId] = mapping;
    }
  }
  const movementKeys = new Set(snapshot.movements.map((m) => m.sourceKey));
  const unknown = mappings.includeDuplicates.find((key) => !movementKeys.has(key));
  if (unknown !== undefined) return invalidMapping("unknownSource", unknown);
  return ok({ ...mappings, timeZone: zone.value, categories });
};
