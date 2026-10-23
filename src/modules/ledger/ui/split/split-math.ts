import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import { decimalOf, type NumberFormat } from "@/shared/ui/format/formatters";

export type ShareMethod = "EQUAL" | "PERCENT" | "EXACT" | "SHARES";
export type SplitMethod = "BY_ALLOCATION" | ShareMethod;
/** The Split artboard's order: the plan's split first, the others as a member picks them (spec 5.2). */
export const SPLIT_METHODS: readonly SplitMethod[] = ["BY_ALLOCATION", "EQUAL", "PERCENT", "EXACT", "SHARES"];

export interface ParticipantValue {
  readonly memberId: string;
  /** What the person typed for this member: a percent, an amount or units; unused for EQUAL. */
  readonly value: string;
}

export type SplitCheck =
  | { readonly ok: true; readonly shares: readonly { readonly memberId: string; readonly amount: string }[] }
  | { readonly ok: false; readonly reason: "noParticipants" | "tooSmall" }
  | { readonly ok: false; readonly reason: "unreadable"; readonly memberId: string }
  | { readonly ok: false; readonly reason: "percentShort" | "percentOver"; readonly percent: string }
  | { readonly ok: false; readonly reason: "exactShort" | "exactOver"; readonly amount: string };

/** 100 % in basis points, as the server counts percents (two decimals). */
const WHOLE = 10_000n;

/**
 * Ruling P166: `Money.allocate` for the browser. Whole rounding units by largest remainder, ties to the earlier
 * participant; the units below the rounding unit stay with the first participant; a negative amount mirrors.
 */
export const allocateMinor = (minor: bigint, weights: readonly bigint[], roundingUnit: bigint): bigint[] => {
  if (minor < 0n) return allocateMinor(-minor, weights, roundingUnit).map((part) => -part);
  const total = weights.reduce((a, b) => a + b, 0n);
  const units = minor / roundingUnit;
  const subUnit = minor % roundingUnit;
  const shares = weights.map((w, index) => ({ index, base: (units * w) / total, rem: (units * w) % total }));
  let leftover = units - shares.reduce((sum, s) => sum + s.base, 0n);
  const order = [...shares].sort((a, b) => (a.rem === b.rem ? a.index - b.index : a.rem > b.rem ? -1 : 1));
  for (const share of order) {
    if (leftover <= 0n) break;
    share.base += 1n;
    leftover -= 1n;
  }
  return shares.map((s) => s.base * roundingUnit + (s.index === 0 ? subUnit : 0n));
};

const positive = (value: bigint | null): value is bigint => value !== null && value > 0n;

/** A typed decimal in minor units of `exponent` decimals, or null (unreadable or too many decimals). */
const minorFrom = (text: string, numberFormat: NumberFormat, exponent: number): bigint | null => {
  const decimal = parseDecimal(text, numberFormat);
  const minor = decimal === null ? null : minorOf(decimal, exponent);
  return minor === null ? null : BigInt(minor);
};

/**
 * HU-E9-06, ruling P166: each participant's share of `amount` (minor units), exactly as `splitShares` computes it, or
 * why the split cannot be saved. `participants` come in the space's join order (the server sorts them so too).
 */
export const previewSplit = (input: {
  readonly method: ShareMethod;
  readonly amount: string;
  readonly currency: string;
  readonly numberFormat: NumberFormat;
  readonly participants: readonly ParticipantValue[];
}): SplitCheck => {
  const { participants, numberFormat } = input;
  if (participants.length === 0) return { ok: false, reason: "noParticipants" };
  const total = BigInt(input.amount);
  const { exponent, roundingUnit } = currencyOf(input.currency);
  const unreadable = (index: number): SplitCheck => ({
    ok: false,
    reason: "unreadable",
    memberId: participants[index]!.memberId,
  });
  let parts: bigint[];
  switch (input.method) {
    case "EQUAL":
      parts = allocateMinor(
        total,
        participants.map(() => 1n),
        roundingUnit,
      );
      break;
    case "SHARES": {
      // The request sends units as numbers, which the server accepts only as safe integers.
      const units = participants.map((p) => {
        const text = p.value.trim();
        return /^\d+$/.test(text) && BigInt(text) <= BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(text) : null;
      });
      const bad = units.findIndex((u) => !positive(u));
      if (bad >= 0) return unreadable(bad);
      parts = allocateMinor(total, units as bigint[], roundingUnit);
      break;
    }
    case "PERCENT": {
      const points = participants.map((p) => minorFrom(p.value, numberFormat, 2));
      const bad = points.findIndex((p) => !positive(p));
      if (bad >= 0) return unreadable(bad);
      const sum = (points as bigint[]).reduce((a, b) => a + b, 0n);
      if (sum !== WHOLE) {
        const gap = sum < WHOLE ? WHOLE - sum : sum - WHOLE;
        return {
          ok: false,
          reason: sum < WHOLE ? "percentShort" : "percentOver",
          percent: decimalOf(String(gap), 2),
        };
      }
      parts = allocateMinor(total, points as bigint[], roundingUnit);
      break;
    }
    case "EXACT": {
      const amounts = participants.map((p) => minorFrom(p.value, numberFormat, exponent));
      const bad = amounts.findIndex((a) => !positive(a));
      if (bad >= 0) return unreadable(bad);
      const sum = (amounts as bigint[]).reduce((a, b) => a + b, 0n);
      if (sum !== total)
        return {
          ok: false,
          reason: sum < total ? "exactShort" : "exactOver",
          amount: String(sum < total ? total - sum : sum - total),
        };
      parts = amounts as bigint[];
      break;
    }
  }
  if (parts.some((part) => part <= 0n)) return { ok: false, reason: "tooSmall" };
  return {
    ok: true,
    shares: participants.map((p, i) => ({ memberId: p.memberId, amount: String(parts[i]) })),
  };
};
