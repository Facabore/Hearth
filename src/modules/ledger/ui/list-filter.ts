import type { PaletteKey } from "@/shared/kernel/style";
import type { AccountDto, CategoryGroupDto, SpaceDto } from "@/shared/ui/api/dto";

/** HU-E9-03: what Movimientos is narrowed to; its address (`hrefOf`) and the API's query (`listQueryOf`) follow it. */
export type TransactionKind = "EXPENSE" | "INCOME" | "TRANSFER" | "SETTLEMENT";

export interface ListFilter {
  readonly period?: string;
  /** Ruling P319: the personal Movimientos narrowed to one of the person's spaces (`?space=`); absent, all of them. */
  readonly spaceId?: string;
  readonly categoryId?: string;
  /** Issue #148: only what this member paid, in a shared space. */
  readonly payerMemberId?: string;
  /** Ruling P277: only what this account paid, received or moved (`?acct=`: `?account=` names a saved notice's fund). */
  readonly accountId?: string;
  /** Ruling P277: only this kind of movement. */
  readonly type?: TransactionKind;
  /** Ruling P277: a piece of the description (`?q=`). */
  readonly search?: string;
}

/**
 * Ruling P319: one of the person's current spaces in the personal Movimientos, for its space filter, and the categories
 * and accounts its other filters offer while it is shown.
 */
export interface ListSpace {
  readonly id: string;
  readonly name: string;
  readonly kind: SpaceDto["kind"];
  readonly color: PaletteKey;
  readonly groups: readonly CategoryGroupDto[];
  readonly accounts: readonly AccountDto[];
}
