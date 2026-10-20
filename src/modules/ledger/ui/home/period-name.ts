import type { PeriodDto, SpaceDto } from "@/shared/ui/api/dto";

/** A MONTHLY day-1 period is its calendar month ("octubre"); any other period is named by its dates. */
export const periodName = (
  period: PeriodDto,
  policy: SpaceDto["periodPolicy"],
): { kind: "month"; month: number; year: number } | { kind: "range"; start: string; end: string } =>
  policy.kind === "MONTHLY" && policy.day === 1
    ? {
        kind: "month",
        month: Number(period.startDate.slice(5, 7)),
        year: Number(period.startDate.slice(0, 4)),
      }
    : { kind: "range", start: period.startDate, end: period.endDate };
