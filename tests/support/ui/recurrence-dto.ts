import type { components } from "@/shared/ui/api/schema";
import { cop } from "./dto";

type RecurrenceDto = components["schemas"]["Recurrence"];

/**
 * HU-E9-09's "Arriendo": Ana's ACTIVE AUTO expense of $ 1.200.000 in "Rent", paid from Bancolombia on day 1 of every
 * month from 2026-12-01, next due that day.
 */
export const recurrenceDto = (overrides: Partial<RecurrenceDto> = {}): RecurrenceDto => ({
  id: "r-rent",
  type: "EXPENSE",
  description: "Arriendo",
  amount: cop(1_200_000),
  mode: "AUTO",
  schedule: { kind: "MONTHLY", day: 1 },
  startDate: "2026-12-01",
  endDate: null,
  status: "ACTIVE",
  pauseReason: null,
  nextOccurrence: "2026-12-01",
  categoryId: "c-rent",
  payerMemberId: "m-ana",
  sourceAccountId: "a-bank",
  destinationAccountId: null,
  split: null,
  lastOccurrence: null,
  createdBy: "u-ana",
  createdAt: "2026-11-01T12:00:00.000Z",
  ...overrides,
});
