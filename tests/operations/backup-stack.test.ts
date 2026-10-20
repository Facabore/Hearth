import { describe, expect, it } from "vitest";
import {
  activeBackupStacks,
  leftovers,
  startBackupStack,
  stopAllBackupStacks,
} from "../support/backup-stack";

describe("the backup test stack", () => {
  it("leaves no container, volume or network behind once stopped", async () => {
    const stack = await startBackupStack();
    try {
      stack.start(["sleep"], ["300"]);
      stack.volume();
      expect(stack.run("echo ok").stdout).toBe("ok\n");
      // The network, the backups volume, the database, the sleeping container and the extra volume.
      expect(leftovers(stack.label)).toHaveLength(5);
    } finally {
      await stack.stop();
    }
    expect(leftovers(stack.label)).toEqual([]);
    expect(activeBackupStacks()).not.toContain(stack.label);
  });

  it("ends the pool of a stack nobody stopped before removing its database", async () => {
    const stack = await startBackupStack();
    await stack.pool.query("SELECT 1");
    await stopAllBackupStacks();
    // Otherwise the pool's idle connections are reset by the removed database and surface as an unhandled error.
    expect(stack.pool.ended).toBe(true);
    expect(leftovers(stack.label)).toEqual([]);
  });

  it("can stop a stack whose start has not returned yet, as after a beforeAll that timed out", async () => {
    // The caller of a start that is still running holds nothing to stop: the registry is what the teardown uses.
    const starting = startBackupStack();
    // Once its stack is gone the start fails by itself (after PostgreSQL stops answering); nobody waits for that here.
    void starting.then(
      (stack) => stack.stop(),
      () => undefined,
    );
    const [label] = activeBackupStacks();
    try {
      expect(label).toBeDefined();
      expect(leftovers(label!).length).toBeGreaterThan(0);
      await stopAllBackupStacks();
      expect(leftovers(label!)).toEqual([]);
      expect(activeBackupStacks()).toEqual([]);
    } finally {
      await stopAllBackupStacks();
    }
  });
});
