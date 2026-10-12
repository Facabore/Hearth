export interface RateLimiter {
  /** Counts one attempt for `key`; false once the key exceeded its limit in the current window. */
  hit(key: string): boolean;
  /** Keys currently tracked (for tests and diagnostics). */
  size(): number;
}

/**
 * In-memory fixed-window limiter. Hearth runs as a single self-hosted instance, so process
 * memory is the right store; a restart simply resets the windows.
 */
export const createFixedWindowLimiter = (opts: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter => {
  const now = opts.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number }>();
  let lastSweep = now();

  const sweep = (at: number) => {
    if (at - lastSweep < opts.windowMs) return;
    for (const [key, window] of windows) if (at - window.start >= opts.windowMs) windows.delete(key);
    lastSweep = at;
  };

  return {
    hit(key) {
      const at = now();
      sweep(at);
      const current = windows.get(key);
      if (!current || at - current.start >= opts.windowMs) {
        windows.set(key, { start: at, count: 1 });
        return opts.limit >= 1;
      }
      current.count += 1;
      return current.count <= opts.limit;
    },
    size: () => windows.size,
  };
};

/** Client address as forwarded by the reverse proxy (Caddy sets X-Forwarded-For). */
export const clientIpOf = (headers: Headers): string =>
  headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "unknown";
