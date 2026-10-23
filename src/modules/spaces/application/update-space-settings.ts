import {
  currencyOf,
  domainError,
  err,
  ok,
  type PeriodPolicy,
  type Result,
  type TransactionManager,
} from "@/shared/kernel";
import { checkedPeriodPolicy, spaceName } from "../domain/space";
import { MANAGERS, requireRole, toSpaceSummary, type SpaceAccess } from "./space-access";
import type { SpaceSummary } from "./space-repository";
import type { SpaceSettingsRepository } from "./space-settings-repository";

/**
 * Whether a space already records money in its currency: transactions, plans, recurrences (ended ones included), or
 * accounts that hold an amount (issue 169: a starter account at zero holds none); bound by the composition root.
 */
export interface SpaceUsage {
  hasMoneyRecords(spaceId: string): Promise<boolean>;
}

export interface UpdateSpaceSettingsDeps {
  readonly spaces: SpaceSettingsRepository;
  readonly access: SpaceAccess;
  readonly usage: SpaceUsage;
  readonly tm: TransactionManager;
}

export interface SpaceSettingsChanges {
  readonly name?: string;
  readonly currency?: string;
  readonly periodPolicy?: PeriodPolicy;
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
      // D6, HU-E1-03: one currency per space, fixed once money has been recorded in it.
      if (currency.value.code !== current.currency && (await deps.usage.hasMoneyRecords(current.spaceId))) {
        return err(domainError("SpaceCurrencyLocked"));
      }
      const settings = { name: name.value, currency: currency.value.code, periodPolicy: periodPolicy.value };
      // D10: plan boundaries are stored, so a new policy only affects periods without a plan.
      await deps.spaces.updateSettings(current.spaceId, settings);
      return ok(toSpaceSummary({ ...current, ...settings }));
    });
