import type { TransactionDto } from "@/shared/ui/api/dto";

type Body = Readonly<Record<string, unknown>>;
const json = (value: unknown) => JSON.stringify(value ?? null);
const payerOf = (body: Body) =>
  json(
    (body.payments as { memberId: string | null; accountId: string | null }[] | undefined)?.map(
      ({ memberId, accountId }) => ({ memberId, accountId }),
    ),
  );

/** Spec 7: the version as the strong ETag `etagOf` writes. */
export const ifMatchOf = (version: number): string => `"${version}"`;

/**
 * Ruling P192: the PATCH body: each key whose request differs from the one the untouched form builds. The time
 * travels whole and only when the person changed it (an untimed row's made-up time never travels). A new amount
 * on an expense with several shares re-sends the split, since the API keeps shares that would no longer add up.
 */
export const editBodyOf = (input: {
  readonly tx: TransactionDto;
  readonly baseline: Body;
  readonly current: Body;
  readonly whenChanged: boolean;
}): Record<string, unknown> => {
  const { tx, baseline, current } = input;
  const differs = (key: string) => json(baseline[key]) !== json(current[key]);
  const body: Record<string, unknown> = {};
  if (differs("description")) body.description = current.description ?? "";
  if (differs("amount")) body.amount = current.amount;
  if (differs("categoryId") && current.categoryId !== undefined) body.categoryId = current.categoryId;
  if (input.whenChanged) {
    body.date = current.date;
    body.occurredAt = current.occurredAt;
    body.timeZone = current.timeZone;
  }
  for (const key of ["accountId", "sourceAccountId", "destinationAccountId"] as const)
    if (differs(key) && current[key] !== undefined) body[key] = current[key];
  if (tx.type === "EXPENSE" && current.payments !== undefined && payerOf(baseline) !== payerOf(current))
    body.payments = current.payments;
  if (
    tx.type === "EXPENSE" &&
    current.split &&
    (differs("split") || (body.amount !== undefined && tx.shares.length > 1))
  )
    body.split = current.split;
  return body;
};
