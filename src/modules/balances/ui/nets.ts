import type { MoneyDto } from "@/shared/ui/api/dto";

/**
 * Ruling P342 (S4): a standing's non-zero nets, one per currency and never converted, the space's currency first, as
 * the API sends them. An older API that sends only the space's net answers that one, or none when it is zero. Pure, with
 * no formatter: Amigos' sheets that load on their own import it (ADR 0004).
 */
export const netsOf = (standing: {
  readonly net: MoneyDto;
  readonly nets?: readonly MoneyDto[] | undefined;
}): readonly MoneyDto[] => standing.nets ?? (BigInt(standing.net.amount) === 0n ? [] : [standing.net]);
