import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import es from "../../../src/i18n/messages/es.json" with { type: "json" };
import { SeedApi } from "./api";

/** One scenario's state: its page, its visitor address, the person it signed up and the catalog it reads. */
export class World {
  readonly api: SeedApi;
  user: { name: string; email: string; spaceId: string } | undefined;
  readonly accounts = new Map<string, string>();
  readonly categories = new Map<string, string>();
  private readonly suffix: string;

  constructor(
    readonly page: Page,
    testId: string,
    private readonly ip: string,
  ) {
    this.suffix = createHash("sha256").update(testId).digest("hex").slice(0, 8);
    this.api = new SeedApi(page.request, () => this.headers());
  }

  /** A message of the Spanish catalog, with `{name}` placeholders filled; a missing key throws. */
  t(key: string, values: Record<string, string> = {}): string {
    let node: unknown = es;
    for (const part of key.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
    if (typeof node !== "string") throw new Error(`No message ${key} in es.json`);
    return node.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`);
  }

  /** A per-test address for a scenario's email: one Ana per test in one database. */
  email(alias: string): string {
    const [local, domain] = alias.split("@");
    return `${local}+${this.suffix}@${domain}`;
  }

  headers(extra: Record<string, string> = {}): Record<string, string> {
    return { "x-forwarded-for": this.ip, ...extra };
  }

  /** Signs `name` up through the API (the page's cookies get the session) and keeps the personal space. */
  async signUp(name: string, { timezone = "America/Bogota" }: { timezone?: string } = {}): Promise<void> {
    const email = this.email(`${name.toLowerCase()}@example.com`);
    await this.api.post("/api/v1/auth/sign-up", { name, email, password: "123456789012", timezone });
    const spaces = (await this.api.get("/api/v1/spaces")) as { items: { id: string; kind: string }[] };
    const personal = spaces.items.find((space) => space.kind === "PERSONAL");
    if (!personal) throw new Error(`${name} has no personal space`);
    this.user = { name, email, spaceId: personal.id };
  }
}
