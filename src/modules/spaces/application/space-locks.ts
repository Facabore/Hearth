/**
 * Issue #89: the space's own row serializes the zero-balance checks of leaving, removing a guest and archiving against
 * the money writes that name a member or land in the space. Both locks are taken as the first statement after the
 * transaction opens (or, for the lifecycle, right after authorization), always before any member row, so every
 * writer queues on this one row first and the member-row locks below it can never form a cycle.
 *
 * `FOR SHARE` conflicts with `FOR NO KEY UPDATE` and with nothing the foreign-key checks of inserts take (those are
 * `FOR KEY SHARE`), so money writes run side by side and a lifecycle change waits for the ones already inside.
 */
export interface SpaceLocks {
  /**
   * A money write (expense, settlement, fund contribution, income, transfer, edit, delete, occurrence; issue #245: an
   * account's creation or edit) holds the space row FOR SHARE until its transaction ends. It waits for a leave, removal,
   * archive or settings change in progress and then reads the committed result: a member who left is no longer
   * current, an archived space refuses the write and a new currency is the one amounts must be in. A no-op for an id
   * that is not a UUID.
   */
  lockForMoneyWrite(spaceId: string): Promise<void>;
  /**
   * A leave, a guest removal, an archive or (issue #245) a settings change holds the space row FOR NO KEY UPDATE until
   * its transaction ends. It waits for the money writes already inside, so the balance or the money records it reads
   * next include them, and keeps later ones out until it commits. A no-op for an id that is not a UUID.
   */
  lockForLifecycle(spaceId: string): Promise<void>;
}
