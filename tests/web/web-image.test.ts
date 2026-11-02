import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
