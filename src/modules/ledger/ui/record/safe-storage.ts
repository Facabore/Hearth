/**
 * The browser's localStorage, or undefined where there is none or reading the property itself throws (a blocked
 * storage raises a SecurityError on access, before any of its methods runs). A module of its own: the last account
 * (#208) is shared with other modules' chunks, and importing it from the recents would carry them along.
 */
export const safeStorage = (): Storage | undefined => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};
