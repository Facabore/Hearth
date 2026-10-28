/**
 * The visitor's language lives in a cookie (ruling P120) that the language toggle writes before it asks for a refresh.
 * A cookie has no change event, so a refresh bumps this counter and the intl provider reads the cookie again.
 */
let epoch = 0;
const listeners = new Set<() => void>();

export const bumpLocale = (): void => {
  epoch += 1;
  for (const listener of listeners) listener();
};

export const subscribeLocale = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const localeEpoch = (): number => epoch;
