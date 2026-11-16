/**
 * The minimal outbound HTTP a source adapter needs: fetch a URL and return its body as text, or throw. Injected so a
 * test drives an adapter with a canned body and never touches the network (AGENTS.md: tests use no network).
 */
export interface HttpGet {
  getText(url: string): Promise<string>;
}

/** A `fetch`-based `HttpGet` that aborts after `timeoutMs` and rejects on a non-2xx response. */
export const createHttpGet = (timeoutMs: number): HttpGet => ({
  async getText(url: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json, text/xml, application/xml;q=0.9, */*;q=0.8" },
      });
      if (!response.ok) throw new Error(`GET ${url} responded ${response.status}`);
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  },
});
