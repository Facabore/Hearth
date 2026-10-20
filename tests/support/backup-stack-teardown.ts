import { afterAll } from "vitest";
import { stopAllBackupStacks } from "./backup-stack";

// Runs for every file of the operations project, after the file's own hooks: a stack whose start a timed-out
// `beforeAll` abandoned is still removed.
afterAll(stopAllBackupStacks);
