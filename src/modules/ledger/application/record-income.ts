import { flatMap, type Money, type Result } from "@/shared/kernel";
import { positiveAmount, recordIncome, type Income } from "../domain/transaction";
import { accountInSpace, authorizeWriter, openPeriod, ownAccount, usableCategory } from "./checks";
import type { LedgerDeps } from "./deps";
import { accountLegOf, baseAmountOf } from "./foreign-amount";
import { whenOf, type WhenInput } from "./when";

export interface RecordIncomeInput extends Omit<WhenInput, "userId"> {
  readonly spaceId: string;
  readonly userId: string;
  readonly description?: string;
  readonly categoryId?: string;
  readonly amount: Money;
  /** The requester's own account in this space that receives the money. */
  readonly accountId: string;
  /**
   * D29, slice MC3: the real amount in the space's base currency the bank credited, when `amount` is in another
   * currency; it wins over the rate. Ignored when `amount` is already in the base currency.
   */
  readonly convertedAmount?: Money;
}

export type RecordIncome = (input: RecordIncomeInput) => Promise<Result<Income>>;

export const createRecordIncome =
  (deps: LedgerDeps): RecordIncome =>
  (input) =>
    deps.tm.run(async () => {
      const writer = await authorizeWriter(deps, input.spaceId, input.userId);
      if (!writer.ok) return writer;
      const space = writer.value;
      const amount = positiveAmount(input.amount.minor);
      if (!amount.ok) return amount;
      const category = await usableCategory(deps, space.spaceId, input.categoryId);
      if (!category.ok) return category;
      const account = flatMap(await ownAccount(deps, input.accountId, input.userId), (a) =>
        accountInSpace(a, space.spaceId),
      );
      if (!account.ok) return account;
      // HU-E4-14: the recorder's zone unless the request names one (ruling P41).
      const when = await whenOf(deps, input);
      if (!when.ok) return when;
      const { date, occurredAt, timeZone } = when.value;
      const open = await openPeriod(deps, space.spaceId, date);
      if (!open.ok) return open;
      // D29 section 4.2: the stored base amount (space currency) and, for a foreign amount, the original kept with it;
      // the rate lookup is a read inside the already-held space lock (#89).
      const base = await baseAmountOf(deps, space, input.amount, input.convertedAmount, date);
      if (!base.ok) return base;
      // D29, section 4.1: the destination leg in the account's own currency whenever it is not the base: what was
      // entered when the account holds that currency, else the base amount at the date's rate.
      const destination = await accountLegOf(
        deps,
        space,
        account.value.id,
        base.value.base,
        [input.amount],
        date,
      );
      if (!destination.ok) return destination;
      const income = recordIncome({
        id: deps.ids.next<"Transaction">(),
        spaceId: space.spaceId,
        description: input.description,
        date,
        amount: base.value.base.minor,
        currency: space.currency,
        createdBy: input.userId,
        occurredAt,
        timeZone,
        now: deps.clock.now(),
        categoryId: category.value,
        destinationAccountId: account.value.id,
        receivingMemberId: space.memberId,
        ...(base.value.original === undefined
          ? {}
          : { originalAmount: base.value.original.amount, originalCurrency: base.value.original.currency }),
        destination: destination.value,
      });
      if (!income.ok) return income;
      await deps.transactions.add(income.value);
      return income;
    });
