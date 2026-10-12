import { z } from "zod";
import { Money, type Result } from "@/shared/kernel";

const INTEGER = /^-?\d{1,19}$/;
const BIGINT_MIN = -(2n ** 63n);
const BIGINT_MAX = 2n ** 63n - 1n;

// Zod 4 keeps running checks after a failed regex, so the range check skips what the regex already rejected.
const withinBigintRange = (value: string): boolean =>
  !INTEGER.test(value) || (BigInt(value) >= BIGINT_MIN && BigInt(value) <= BIGINT_MAX);

/** Money on the wire: minor units as an integer string (PostgreSQL bigint range) plus an ISO 4217 code. */
export const MoneySchema = z.object({
  amount: z
    .string()
    .regex(INTEGER, { error: "Amount must be an integer string in minor units" })
    .refine(withinBigintRange, { error: "Amount is outside the supported range" }),
  currency: z.string().regex(/^[A-Z]{3}$/, { error: "Currency must be an ISO 4217 code" }),
});
export type MoneyDto = z.infer<typeof MoneySchema>;

export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  requestId: z.string(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

export const moneyToDto = (money: Money): MoneyDto => ({
  amount: money.minor.toString(),
  currency: money.currency.code,
});

/** Expects a DTO already validated by MoneySchema; fails only for currencies the kernel does not know. */
export const moneyFromDto = (dto: MoneyDto): Result<Money> => Money.ofMinor(BigInt(dto.amount), dto.currency);

/** Standard error responses for operations; every protected operation lists 401. */
export const problemContent = { "application/problem+json": { schema: ProblemSchema } } as const;
