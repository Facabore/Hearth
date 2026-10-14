import type { SpaceRole } from "./space";

/**
 * HU-E1-05 permission matrix, a pure policy (pending owner confirmation, docs/product/functional-overview.md).
 * Guests have no role (spec D15): they never act themselves, so no action lists them.
 */
const MATRIX = {
  /** View the space, its members and transactions, and (HU-E5-01) its balances. */
  "space.read": ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
  /** Rename, currency and period policy (HU-E1-03); the category tree (HU-E3-02). */
  "space.manage": ["OWNER", "ADMIN"],
  /** HU-E1-09. */
  "space.archive": ["OWNER"],
  /** HU-E1-08: any current member leaves; the last OWNER and unsettled members cannot. */
  "space.leave": ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
  /** Create and revoke invitations (HU-E1-06) and guest claim links (HU-E1-11). */
  "member.invite": ["OWNER", "ADMIN"],
  /** Only owners change roles, so nobody can raise their own role (HU-E1-05). */
  "member.changeRole": ["OWNER"],
  /** HU-E1-10, D15. */
  "guest.add": ["OWNER", "ADMIN", "MEMBER"],
  /** HU-E1-12, D15: remove a guest whose balance is zero. */
  "guest.remove": ["OWNER", "ADMIN", "MEMBER"],
  /** Expenses, incomes, transfers and settlements, also on a guest's behalf (D15, HU-E4-01). */
  "money.record": ["OWNER", "ADMIN", "MEMBER"],
  /** Change or delete a transaction someone else created (HU-E4-06); creators change their own. */
  "money.editAny": ["OWNER", "ADMIN"],
  /** Create, edit and archive shared fund accounts (HU-E2-02). */
  "fund.manage": ["OWNER", "ADMIN"],
} as const satisfies Record<string, readonly SpaceRole[]>;

export type SpaceAction = keyof typeof MATRIX;

export const SPACE_ACTIONS = Object.keys(MATRIX) as SpaceAction[];

export const rolesFor = (action: SpaceAction): readonly SpaceRole[] => MATRIX[action];

export const can = (role: SpaceRole | null, action: SpaceAction): boolean =>
  role !== null && rolesFor(action).includes(role);

/** HU-E1-09: actions that only read, the only ones an archived space still allows. */
export const isReadOnly = (action: SpaceAction): boolean => action === "space.read";
