import {
  currencyOf,
  domainError,
  err,
  ok,
  type PeriodPolicy,
  type Result,
  type TransactionManager,
} from "@/shared/kernel";
import { checkedPeriodPolicy, checkedSpaceColor, spaceName } from "../domain/space";
import { MANAGERS, requireRole, toSpaceSummary, type SpaceAccess } from "./space-access";
import type { SpaceLocks } from "./space-locks";
import type { SpaceSummary } from "./space-repository";
import type { SpaceSettingsRepository } from "./space-settings-repository";

/**
 * Whether a space already records money in its currency: transactions, plans, recurrences (ended ones included), or
 * accounts that hold an amount (issue 169: a starter account at zero holds none); bound by the composition root.
 */
export interface SpaceUsage {
  hasMoneyRecords(spaceId: string): Promise<boolean>;
}

/**
 * D29, slice MC3 (HU-E1-03): re-tags every account of a space to a new currency. The space currency changes only while
 * the space holds no money (SpaceCurrencyLocked below), so all its accounts are money-free, not yet fixed, and must
 * follow the change. The accounts module owns the implementation; the composition root binds it.
 */
export interface AccountCurrencyRetagger {
  retagCurrency(spaceId: string, currency: string): Promise<void>;
}

export interface UpdateSpaceSettingsDeps {
  readonly spaces: SpaceSettingsRepository;
  /** Issue #245: the currency and the period policy change only while no money write or plan creation is inside. */
  readonly spaceLocks: Pick<SpaceLocks, "lockForLifecycle">;
  readonly access: SpaceAccess;
  readonly usage: SpaceUsage;
  /** D29, slice MC3 (HU-E1-03): follows the space currency onto its accounts; left out, no account is re-tagged. */
  readonly accountCurrency?: AccountCurrencyRetagger;
  readonly tm: TransactionManager;
}

export interface SpaceSettingsChanges {
  readonly name?: string;
  readonly currency?: string;
  readonly periodPolicy?: PeriodPolicy;
  /** Ruling P306: a palette key; null goes back to the derived color. */
  readonly color?: string | null;
}

export type UpdateSpaceSettings = (input: {
  spaceId: string;
  userId: string;
  changes: SpaceSettingsChanges;
}) => Promise<Result<SpaceSummary>>;

export const createUpdateSpaceSettings =
  (deps: UpdateSpaceSettingsDeps): UpdateSpaceSettings =>
  (input) =>
    deps.tm.run(async () => {
      // Issue #245: before the membership, as a leave does (#89). The money writes already inside commit first, so the
      // usage read below sees them, and the ones that follow read the settings this change commits.
      await deps.spaceLocks.lockForLifecycle(input.spaceId);
      const membership = await deps.access(input.spaceId, input.userId);
      if (!membership.ok) return membership;
      const allowed = requireRole(membership.value, MANAGERS);
      if (!allowed.ok) return allowed;
      const current = allowed.value;
      const { changes } = input;
      const name = changes.name === undefined ? ok(current.name) : spaceName(changes.name);
      if (!name.ok) return name;
      const periodPolicy =
        changes.periodPolicy === undefined
          ? ok(current.periodPolicy)
          : checkedPeriodPolicy(changes.periodPolicy);
      if (!periodPolicy.ok) return periodPolicy;
      const currency = currencyOf(changes.currency ?? current.currency);
      if (!currency.ok) return currency;
      const color =
        changes.color === undefined
          ? ok(current.color)
          : changes.color === null
            ? ok(null)
            : checkedSpaceColor(changes.color);
      if (!color.ok) return color;
      // D6, HU-E1-03: one currency per space, fixed once money has been recorded in it.
      if (currency.value.code !== current.currency && (await deps.usage.hasMoneyRecords(current.spaceId))) {
        return err(domainError("SpaceCurrencyLocked"));
      }
      const settings = {
        name: name.value,
        currency: currency.value.code,
        periodPolicy: periodPolicy.value,
        color: color.value,
      };
      // D10: plan boundaries are stored, so a new policy only affects periods without a plan.
      await deps.spaces.updateSettings(current.spaceId, settings);
      // D29, slice MC3 (HU-E1-03): the space holds no money when its currency changes, so every account is money-free
      // and must follow it; re-tag them in this same settings transaction, which already holds the lifecycle lock.
      if (currency.value.code !== current.currency) {
        await deps.accountCurrency?.retagCurrency(current.spaceId, currency.value.code);
      }
      return ok(toSpaceSummary({ ...current, ...settings }));
    });
