import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, cspHeader } from "../../vite.spa.config";

/**
 * The `web` image (ADR 0006): the single-page app's build behind Caddy, `Caddyfile.web`, as the Dockerfile's `web`
 * stage assembles it. These read the files as they ship; the e2e specs serve the build with Vite's preview instead.
 */
const caddyfile = readFileSync("Caddyfile.web", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");

/** The Caddyfile's directives, one per line, without comments and indentation. */
const directives = caddyfile
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "" && !line.startsWith("#"));

/** The Dockerfile's instructions of one stage, from its FROM to the next. */
const stage = (name: string): string =>
  new RegExp(`^FROM [^\\n]+ AS ${name}\\n([\\s\\S]*?)(?=^FROM |(?![\\s\\S]))`, "m").exec(dockerfile)?.[1] ??
  "";

/** The site block's own `header { … }` directive, as a map of each header's name to its value. */
const siteHeaders = (): Record<string, string> => {
  const block = /^\theader \{\n([\s\S]*?)\n\t\}$/m.exec(caddyfile)?.[1] ?? "";
  return Object.fromEntries(
    block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => {
        const [name = "", ...value] = line.split(" ");
        return [name, value.join(" ").replace(/^"(.*)"$/, "$1")];
      }),
  );
};

describe("the web image (#201)", () => {
  it("sends a bookmark of /app to the root with its query, as /app/… already does", () => {
    expect(directives).toContain("redir /app /{?query} 308");
    expect(directives).toContain("redir * {uri} 308");
  });

  it("does not ship Vite's build manifest, which the file handler would serve", () => {
    expect(stage("spa-builder")).toMatch(/^RUN pnpm spa:build && rm -r dist\/spa\/\.vite$/m);
    expect(stage("web")).toContain("COPY --from=spa-builder /app/dist/spa /srv/app");
  });
});

describe("the web image's security headers (#201, ruling P280)", () => {
  it("sends the fixed headers on every response", () => {
    expect(siteHeaders()).toEqual({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
  });

  it("sends the Content-Security-Policy that the build wrote for its own index.html", () => {
    expect(directives).toContain("import /etc/caddy/csp.caddy");
    expect(stage("web")).toContain("COPY --from=spa-builder /app/dist/caddy/csp.caddy /etc/caddy/csp.caddy");
  });
});

describe("the SPA's Content-Security-Policy (#201, ruling P280)", () => {
  const sha256 = (code: string) => `'sha256-${createHash("sha256").update(code).digest("base64")}'`;
  const html = [
    "<!doctype html><html><head>",
    "<script>(function(){a()})()</script>",
    '<script type="module" crossorigin src="/assets/index-x.js"></script>',
    "<script>\nb();\n</script>",
    "<script>(function(){a()})()</script>",
    "<style>body{}</style>",
    "</head><body></body></html>",
  ].join("");

  it("lets in the app's own scripts and each inline script by its hash, and nothing else", () => {
    const scriptSrc = contentSecurityPolicy(html)
      .split("; ")
      .find((part) => part.startsWith("script-src "));
    expect(scriptSrc).toBe(`script-src 'self' ${sha256("(function(){a()})()")} ${sha256("\nb();\n")}`);
  });

  it("keeps everything else to the app's own origin, and the page out of any frame", () => {
    expect(contentSecurityPolicy(html).split("; ")).toEqual([
      "default-src 'self'",
      expect.stringMatching(/^script-src 'self' /),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ]);
  });

  it("is written as the Caddy header directive the web image imports", () => {
    expect(cspHeader("default-src 'self'")).toBe(`header Content-Security-Policy "default-src 'self'"\n`);
  });
});
