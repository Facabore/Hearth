import { describe, expect, it } from "vitest";
import { leftovers, startBackupStack } from "../support/backup-stack";

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
  });
});
