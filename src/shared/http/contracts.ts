import { z } from "zod";
import { localDate, Money, ok, type LocalDate, type Period, type Result } from "@/shared/kernel";

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
  /** OutstandingBalance only (HU-E1-08, HU-E1-09, HU-E1-12): what is still owed, a positive amount. */
  outstanding: MoneySchema.optional(),
});

export const moneyToDto = (money: Money): MoneyDto => ({
  amount: money.minor.toString(),
  currency: money.currency.code,
});

/** Expects a DTO already validated by MoneySchema; fails only for currencies the kernel does not know. */
export const moneyFromDto = (dto: MoneyDto): Result<Money> => Money.ofMinor(BigInt(dto.amount), dto.currency);

/** Standard error responses for operations; every protected operation lists 401. */
export const problemContent = { "application/problem+json": { schema: ProblemSchema } } as const;

/** `content` of a JSON request or response. */
export const jsonContent = (schema: z.ZodType) => ({ "application/json": { schema } });

/** Problem responses keyed by status, e.g. `problems({ "404": "SpaceNotFound" })`. */
export const problems = (descriptions: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(descriptions).map(([status, description]) => [
      status,
      { description, content: problemContent },
    ]),
  );

/** Operations that need a signed-in user accept the session cookie or a Bearer token. */
export const securedByUser: { security: Record<string, string[]>[] } = {
  security: [{ cookieAuth: [] }, { bearerAuth: [] }],
};

/** Validates an optional ISO date from a request: absent stays undefined, impossible dates are InvalidDate. */
export const optionalLocalDate = (iso: string | undefined): Result<LocalDate | undefined> =>
  iso === undefined ? ok(undefined) : localDate(iso);

/** A period on the wire (HU-E1-03, HU-E4-04). */
export const PeriodSchema = z.object({ label: z.string(), startDate: z.iso.date(), endDate: z.iso.date() });

export const periodDto = (period: Period): z.infer<typeof PeriodSchema> => ({
  label: period.label,
  startDate: period.start,
  endDate: period.end,
});
