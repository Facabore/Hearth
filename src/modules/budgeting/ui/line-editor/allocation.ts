import type { MoneyDto, PlanLineDto } from "@/shared/ui/api/dto";
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import { decimalOf, formatNumber, type Formats, type NumberFormat } from "@/shared/ui/format/formatters";

export type AllocationRule = PlanLineDto["allocation"]["rule"];

/** What the person typed per member: a percentage (PERCENT) or an amount (FIXED), in their number format. */
export interface AllocationDraft {
  readonly rule: AllocationRule;
  readonly values: Readonly<Record<string, string>>;
}

const WHOLE = 10_000n; // 100 % in basis points, as the server counts (HU-E6-05)

export const allocationDraftOf = (
  line: PlanLineDto | null,
  formats: Pick<Formats, "numberFormat">,
): AllocationDraft => {
  if (line === null) return { rule: "PROPORTIONAL", values: {} };
  const { rule, members } = line.allocation;
  const values = Object.fromEntries(
    members.flatMap((m) => {
      if (rule === "PERCENT" && m.percent !== null) return [[m.memberId, formatNumber(m.percent, formats)]];
      if (rule === "FIXED" && m.amount !== null)
        return [
          [
            m.memberId,
            formatNumber(decimalOf(m.amount.amount, currencyOf(m.amount.currency).exponent), formats),
          ],
        ];
      return [];
    }),
  );
  return { rule, values };
};

/**
 * Ruling P211: the kernel's `Money.allocate`, mirrored: whole rounding units shared by largest remainder (ties to
 * the earlier weight) and the sub-unit remainder on the first part. The caller passes a positive total weight.
 */
export const allocate = (total: bigint, weights: readonly bigint[], roundingUnit: bigint): bigint[] => {
  if (total < 0n) return allocate(-total, weights, roundingUnit).map((part) => -part);
  const totalWeight = weights.reduce((a, b) => a + b, 0n);
  const units = total / roundingUnit;
  const subUnit = total % roundingUnit;
  const shares = weights.map((w, index) => ({
    index,
    base: (units * w) / totalWeight,
    rem: (units * w) % totalWeight,
  }));
  let leftover = units - shares.reduce((sum, s) => sum + s.base, 0n);
  const order = [...shares].sort((a, b) => (a.rem === b.rem ? a.index - b.index : a.rem > b.rem ? -1 : 1));
  for (const share of order) {
    if (leftover <= 0n) break;
    share.base += 1n;
    leftover -= 1n;
  }
  return shares.map((s) => s.base * roundingUnit + (s.index === 0 ? subUnit : 0n));
};

export type Preview =
  | { readonly kind: "none" }
  | { readonly kind: "assigned"; readonly amounts: Readonly<Record<string, string>> }
  | { readonly kind: "invalid"; readonly sum: string; readonly unit: "percent" | "money" }
  | { readonly kind: "noCapacity" }
  | { readonly kind: "unreadable"; readonly memberId: string };

/** Each typed value as basis points (PERCENT) or minor units (FIXED); null when unreadable; empty is 0. */
const valuesOf = (
  draft: AllocationDraft,
  memberIds: readonly string[],
  exponent: number,
  numberFormat: NumberFormat,
): { memberId: string; value: bigint }[] | { unreadable: string } => {
  const scale = draft.rule === "PERCENT" ? 2 : exponent;
  const out: { memberId: string; value: bigint }[] = [];
  for (const memberId of memberIds) {
    const text = (draft.values[memberId] ?? "").trim();
    if (text === "") {
      out.push({ memberId, value: 0n });
      continue;
    }
    const decimal = parseDecimal(text, numberFormat);
    const minor = decimal === null ? null : minorOf(decimal, scale);
    if (minor === null) return { unreadable: memberId };
    out.push({ memberId, value: BigInt(minor) });
  }
  return out;
};

/** HU-E6-05: what each current member would be assigned, before the server confirms it on save. */
export const previewOf = (
  draft: AllocationDraft,
  input: {
    readonly planned: string;
    readonly currency: string;
    readonly members: readonly { readonly memberId: string; readonly capacity: string }[];
    readonly numberFormat: NumberFormat;
  },
): Preview => {
  if (draft.rule === "NONE") return { kind: "none" };
  const { exponent, roundingUnit } = currencyOf(input.currency);
  const planned = BigInt(input.planned);
  const ids = input.members.map((m) => m.memberId);
  const weights =
    draft.rule === "PROPORTIONAL"
      ? input.members.map((m) => ({ memberId: m.memberId, value: BigInt(m.capacity) }))
      : valuesOf(draft, ids, exponent, input.numberFormat);
  if ("unreadable" in weights) return { kind: "unreadable", memberId: weights.unreadable };
  const sum = weights.reduce((total, w) => total + w.value, 0n);
  if (draft.rule === "PERCENT" && sum !== WHOLE)
    return { kind: "invalid", sum: decimalOf(String(sum), 2), unit: "percent" };
  if (draft.rule === "FIXED") {
    if (sum !== planned) return { kind: "invalid", sum: String(sum), unit: "money" };
    return {
      kind: "assigned",
      amounts: Object.fromEntries(weights.map((w) => [w.memberId, String(w.value)])),
    };
  }
  const weighted = weights.filter((w) => w.value > 0n);
  if (weighted.length === 0) return { kind: "noCapacity" };
  const parts = allocate(
    planned,
    weighted.map((w) => w.value),
    roundingUnit,
  );
  return {
    kind: "assigned",
    amounts: Object.fromEntries(weights.map((w) => [w.memberId, String(parts[weighted.indexOf(w)] ?? 0n)])),
  };
};

export type AllocationBody =
  | { rule: "PROPORTIONAL" }
  | { rule: "NONE" }
  | { rule: "PERCENT"; members: { memberId: string; percent: string }[] }
  | { rule: "FIXED"; members: { memberId: string; amount: MoneyDto }[] };

/** The PUT body: only members with a value; null while the values do not hold (the save is blocked). */
export const allocationBodyOf = (
  draft: AllocationDraft,
  memberIds: readonly string[],
  currency: string,
  numberFormat: NumberFormat,
): AllocationBody | null => {
  if (draft.rule === "PROPORTIONAL" || draft.rule === "NONE") return { rule: draft.rule };
  const values = valuesOf(draft, memberIds, currencyOf(currency).exponent, numberFormat);
  if ("unreadable" in values) return null;
  const listed = values.filter((v) => v.value > 0n);
  const sum = listed.reduce((total, v) => total + v.value, 0n);
  if (draft.rule === "PERCENT") {
    if (sum !== WHOLE) return null;
    return {
      rule: "PERCENT",
      members: listed.map((v) => ({
        memberId: v.memberId,
        percent: parseDecimal(draft.values[v.memberId]!, numberFormat)!,
      })),
    };
  }
  return {
    rule: "FIXED",
    members: listed.map((v) => ({ memberId: v.memberId, amount: { amount: String(v.value), currency } })),
  };
};

/** Whether `body` would change what the line stores; a new line's PROPORTIONAL default sends nothing. */
export const allocationChanged = (line: PlanLineDto | null, body: AllocationBody): boolean => {
  if (line === null) return body.rule !== "PROPORTIONAL";
  if (line.allocation.rule !== body.rule) return true;
  if (body.rule === "PROPORTIONAL" || body.rule === "NONE") return false;
  const stored = new Map(
    line.allocation.members.map((m) => [
      m.memberId,
      body.rule === "PERCENT"
        ? m.percent === null
          ? null
          : minorOf(m.percent, 2)
        : (m.amount?.amount ?? null),
    ]),
  );
  const sent =
    body.rule === "PERCENT"
      ? body.members.map((m) => [m.memberId, minorOf(m.percent, 2)] as const)
      : body.members.map((m) => [m.memberId, m.amount.amount] as const);
  return (
    sent.length !== [...stored.values()].filter((v) => v !== null && v !== "0").length ||
    sent.some(([id, value]) => stored.get(id) !== value)
  );
};
