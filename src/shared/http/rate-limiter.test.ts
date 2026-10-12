import { describe, expect, it } from "vitest";
import { clientIpOf, createFixedWindowLimiter } from "./rate-limiter";

describe("createFixedWindowLimiter", () => {
  it("allows up to the limit per key within a window, then refuses", () => {
    let now = 0;
    const limiter = createFixedWindowLimiter({ limit: 2, windowMs: 1000, now: () => now });
    expect([limiter.hit("a"), limiter.hit("a"), limiter.hit("a")]).toEqual([true, true, false]);
    expect(limiter.hit("b")).toBe(true);
    now = 999;
    expect(limiter.hit("a")).toBe(false);
  });

  it("starts a fresh window once the previous one has passed", () => {
    let now = 0;
    const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 1000, now: () => now });
    expect(limiter.hit("a")).toBe(true);
    expect(limiter.hit("a")).toBe(false);
    now = 1000;
    expect(limiter.hit("a")).toBe(true);
  });

  it("forgets expired keys so memory stays bounded", () => {
    let now = 0;
    const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 1000, now: () => now });
    for (let i = 0; i < 100; i++) limiter.hit(`k${i}`);
    expect(limiter.size()).toBe(100);
    now = 5000;
    limiter.hit("fresh");
    expect(limiter.size()).toBe(1);
  });
});

describe("clientIpOf", () => {
  const withHeaders = (headers: Record<string, string>) => new Headers(headers);

  it("takes the first X-Forwarded-For hop set by the reverse proxy", () => {
    expect(clientIpOf(withHeaders({ "x-forwarded-for": "203.0.113.7, 10.0.0.2" }))).toBe("203.0.113.7");
    expect(clientIpOf(withHeaders({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
  });

  it("falls back to a shared bucket when no address is known", () => {
    expect(clientIpOf(withHeaders({}))).toBe("unknown");
  });
});
