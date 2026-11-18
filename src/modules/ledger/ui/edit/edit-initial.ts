import { findCategory, type CategoryChoice } from "@/modules/categories/ui";
import type { AccountDto, CategoryGroupDto, MoneyDto, TransactionDto } from "@/shared/ui/api/dto";
import { currencyOf } from "@/shared/ui/format/currencies";
import { decimalOf, formatNumber, type Formats } from "@/shared/ui/format/formatters";
import { nowIn } from "@/shared/ui/time/when";
import type { RecordDraft, RecordKind } from "../record/record-request";
import type { When } from "../record/when-label";
import { initialSplitDraft, type SharedExpenseContext } from "../split/shared-context";
import type { Payer, SplitDraft } from "../split/split-request";

/** The record form's starting state when it edits a transaction (ruling P192). */
export interface RecordInitial {
  readonly kind: RecordKind;
  readonly amount: string;
  /**
   * P342: the currency `amount` is typed in: an expense's or income's own, which the edit keeps; an own transfer's
   * source account's (D29, "Sale").
   */
  readonly currency: string;
  /**
   * P342 (board 4): what the one paying (or receiving) account moved in its own currency, when it is not the movement's:
   * an expense's sole payment's `accountAmount`, an income's `destinationAmount`; null otherwise.
   */
  readonly accountLeg?: MoneyDto | null;
  readonly description: string;
  readonly category: CategoryChoice;
  readonly accountId: string | null;
  readonly toAccountId: string | null;
  readonly when: When;
  readonly split: SplitDraft | null;
}

const typed = (minor: string, currency: string, formats: Formats) =>
  formatNumber(decimalOf(minor, currencyOf(currency).exponent), formats);

/** Basis points of each share, rounded half up, the last in join order taking what makes 10,000 (P192). */
const percentsOf = (shares: TransactionDto["shares"], total: bigint): bigint[] => {
  const points = shares.map((s) => (BigInt(s.amount.amount) * 20_000n + total) / (2n * total));
  points[points.length - 1] = 10_000n - points.slice(0, -1).reduce((sum, p) => sum + p, 0n);
  return points;
};
const percentText = (points: bigint, formats: Formats) =>
  formatNumber(`${points / 100n}.${String(points % 100n).padStart(2, "0")}`, formats);

const payerOf = (tx: TransactionDto, shared: SharedExpenseContext): Payer => {
  const paid = tx.payments[0]!;
  if (paid.memberId === null) return { kind: "FUND", accountId: paid.accountId! };
  const member = shared.members.find((m) => m.id === paid.memberId);
  if (member && member.userId === null) return { kind: "GUEST", memberId: paid.memberId };
  // P333 (P168 amended): another member who paid with their own money, so no account of theirs moved.
  if (paid.accountId === null && paid.memberId !== shared.meMemberId)
    return { kind: "MEMBER", memberId: paid.memberId };
  return { kind: "ME", memberId: paid.memberId, accountId: paid.accountId };
};

/** Ruling P192: the split as the form shows it; one the form cannot type back (SHARES, the plan's) becomes percents. */
const splitOf = (tx: TransactionDto, shared: SharedExpenseContext, formats: Formats): SplitDraft => {
  const order = shared.members.map((m) => m.id);
  const shares = [...tx.shares].sort((a, b) => order.indexOf(a.memberId) - order.indexOf(b.memberId));
  const method = shares[0]?.splitMethod ?? "EQUAL";
  const selected = shares.map((s) => s.memberId);
  const payer = payerOf(tx, shared);
  if (method === "EQUAL") return { payer, method, selected, values: {}, chosen: true };
  if (method === "EXACT")
    return {
      payer,
      method,
      selected,
      values: Object.fromEntries(
        shares.map((s) => [s.memberId, typed(s.amount.amount, s.amount.currency, formats)]),
      ),
      chosen: true,
    };
  const points = percentsOf(shares, BigInt(tx.amount.amount));
  return {
    payer,
    method: "PERCENT",
    selected,
    values: Object.fromEntries(shares.map((s, i) => [s.memberId, percentText(points[i]!, formats)])),
    chosen: true,
  };
};

/** Issue #195: a contribution switched to an expense starts paid by its payer, from the account it came from. */
const contributionSplitOf = (tx: TransactionDto, shared: SharedExpenseContext): SplitDraft => {
  const payer = shared.members.find((m) => m.id === tx.payerMemberId);
  return {
    ...initialSplitDraft(shared),
    payer:
      payer && payer.userId === null
        ? { kind: "GUEST", memberId: payer.id }
        : { kind: "ME", memberId: tx.payerMemberId!, accountId: tx.sourceAccountId },
  };
};

/** D29, board 10: an own transfer's amount as "Sale", in the source account's currency: its own, or its source leg. */
const leavingIn = (tx: TransactionDto, currency: string | undefined): MoneyDto =>
  [tx.amount, tx.sourceAmount].find((amount) => amount?.currency === currency) ?? tx.amount;

/** P342 (board 4): the paying or receiving account's leg, when it moved in another currency than the movement's. */
const accountLegOf = (tx: TransactionDto): MoneyDto | null => {
  const leg =
    tx.type === "EXPENSE" && tx.payments.length === 1
      ? tx.payments[0]!.accountAmount
      : tx.type === "INCOME"
        ? tx.destinationAmount
        : undefined;
  return leg && leg.currency !== tx.amount.currency ? leg : null;
};

export const initialOf = (
  tx: TransactionDto,
  input: {
    /** D29: the person's accounts; an own transfer's amount is typed in its source account's currency. */
    readonly accounts?: readonly AccountDto[];
    readonly groups: readonly CategoryGroupDto[];
    readonly formats: Formats;
    /** The zone an untimed record is read and written in: the editor's. A timed one keeps its own (P192). */
    readonly zone: string;
    readonly now: Date;
    readonly shared?: SharedExpenseContext;
  },
): RecordInitial => {
  const found = tx.categoryId ? findCategory(input.groups, tx.categoryId) : null;
  const category: CategoryChoice = found
    ? found.parent
      ? { categoryId: found.parent.id, subcategoryId: found.category.id }
      : { categoryId: found.category.id, subcategoryId: null }
    : null;
  const wall =
    tx.occurredAt && tx.timeZone
      ? nowIn(new Date(tx.occurredAt), tx.timeZone).wall
      : nowIn(input.now, input.zone).wall;
  const kind = tx.type as RecordKind;
  const sharedExpense = kind === "EXPENSE" && input.shared !== undefined;
  const accountId =
    kind === "INCOME"
      ? tx.destinationAccountId
      : kind === "TRANSFER"
        ? tx.sourceAccountId
        : (tx.payments[0]?.accountId ?? null);
  // P342: an expense or an income is typed in its own currency, and the edit keeps it; D29 (board 10): an own
  // transfer's amount is what left its source account, in that account's currency.
  const source = kind === "TRANSFER" ? input.accounts?.find((a) => a.id === accountId) : undefined;
  const amount = kind === "TRANSFER" ? leavingIn(tx, source?.balance.currency) : tx.amount;
  return {
    kind,
    amount: typed(amount.amount, amount.currency, input.formats),
    currency: amount.currency,
    accountLeg: kind === "TRANSFER" ? null : accountLegOf(tx),
    description: tx.description,
    category: kind === "TRANSFER" ? null : category,
    accountId,
    toAccountId: kind === "TRANSFER" ? tx.destinationAccountId : null,
    when: { date: tx.date, wall },
    split: sharedExpense
      ? splitOf(tx, input.shared!, input.formats)
      : kind === "TRANSFER" && tx.payerMemberId !== null && input.shared
        ? contributionSplitOf(tx, input.shared)
        : null,
  };
};

/** The draft `requestOf` reads, as RecordForm builds it from its state. */
export const draftOf = (initial: RecordInitial, zone: string): RecordDraft => ({
  kind: initial.kind,
  amount: initial.amount,
  description: initial.description,
  category: initial.category,
  accountId: initial.accountId,
  toAccountId: initial.toAccountId,
  when: initial.when,
  timeZone: zone,
});
