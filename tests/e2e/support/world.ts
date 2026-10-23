import { createHash } from "node:crypto";
import type { APIRequest, Page } from "@playwright/test";
import es from "../../../src/i18n/messages/es.json" with { type: "json" };
import { SeedApi } from "./api";
import { minor } from "./money";
import { Person } from "./people";

/** One scenario's state: its page, its visitor address, the person it signed up and the catalog it reads. */
export class World {
  readonly api: SeedApi;
  user: { name: string; email: string; spaceId: string } | undefined;
  readonly accounts = new Map<string, string>();
  readonly categories = new Map<string, string>();
  readonly people = new Map<string, Person>();
  readonly spaces = new Map<string, string>();
  /** The ids of the transactions a scenario recorded through `recordExpense`, by description. */
  readonly transactions = new Map<string, string>();
  private readonly suffix: string;

  constructor(
    readonly page: Page,
    testId: string,
    private readonly ip: string,
    private readonly requests: APIRequest,
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

  private space(path = ""): string {
    if (!this.user) throw new Error("No one is signed up in this scenario");
    return `/api/v1/spaces/${this.user.spaceId}${path}`;
  }

  /** Creates an account in the personal space and keeps its id under `name`. */
  async seedAccount(name: string, body: Record<string, unknown>): Promise<string> {
    const account = (await this.api.post(this.space("/accounts"), { name, ...body })) as { id: string };
    this.accounts.set(name, account.id);
    return account.id;
  }

  /** Creates a category in the seeded group whose key is `food` and keeps its id under `name`. */
  async seedCategory(name: string): Promise<string> {
    const { items } = (await this.api.get(this.space("/categories"))) as {
      items: { id: string; key: string | null }[];
    };
    const food = items.find((group) => group.key === "food");
    if (!food) throw new Error("The personal space has no food group");
    const body = { groupId: food.id, name, icon: { kind: "SYMBOL", name: "cart" }, color: "SAND" };
    const category = (await this.api.post(this.space("/categories"), body)) as { id: string };
    this.categories.set(name, category.id);
    return category.id;
  }

  /** Records a movement through the API, with its own Idempotency-Key as the form sends one. */
  async record(kind: "expenses" | "incomes" | "transfers", body: Record<string, unknown>): Promise<unknown> {
    const response = await this.page.request.post(this.space(`/${kind}`), {
      headers: this.headers({ "idempotency-key": crypto.randomUUID() }),
      data: body,
    });
    if (!response.ok())
      throw new Error(`POST ${kind} answered ${response.status()}: ${await response.text()}`);
    return response.json();
  }

  /** An expense through the API at 2026-10-31 12:00 Bogotá, inside the server's fixed period (P178). */
  async recordExpense(
    description: string,
    pesos: string,
    category: string,
    account: string,
  ): Promise<string> {
    const recorded = (await this.record("expenses", {
      description,
      date: "2026-10-31",
      occurredAt: "2026-10-31T17:00:00.000Z",
      timeZone: "America/Bogota",
      categoryId: this.categories.get(category),
      amount: { amount: minor(pesos), currency: "COP" },
      accountId: this.accounts.get(account),
    })) as { id: string };
    this.transactions.set(description, recorded.id);
    return recorded.id;
  }

  /** Someone else, signed up once per test with their own session (ruling P178). */
  async person(name: string): Promise<Person> {
    const known = this.people.get(name);
    if (known) return known;
    const person = await Person.signUp(
      this.requests,
      name,
      this.email(`${name.toLowerCase()}@example.com`),
      this.headers(),
    );
    this.people.set(name, person);
    return person;
  }

  /** `owner` creates the shared space `name`; its id is kept under its name. */
  async sharedSpace(owner: Person, name: string, currency = "COP"): Promise<string> {
    const { id } = (await owner.api.post("/api/v1/spaces", { kind: "SHARED", name, currency })) as {
      id: string;
    };
    this.spaces.set(name, id);
    return id;
  }

  /** `who` joins `spaceName` through a link invitation `owner` creates with `role`; "me" is the page's person. */
  async join(
    owner: Person,
    spaceName: string,
    who: Person | "me",
    role: "ADMIN" | "MEMBER" | "VIEWER",
  ): Promise<void> {
    const spaceId = this.spaces.get(spaceName)!;
    const { url } = (await owner.api.post(`/api/v1/spaces/${spaceId}/invitations`, {
      kind: "LINK",
      role,
    })) as { url: string };
    const token = new URL(url).pathname.split("/").at(-1)!;
    await (who === "me" ? this.api : who.api).post(`/api/v1/invitations/${token}/accept`, {});
  }

  /** The member id of `name` in `spaceName`, as the space lists its current members. */
  async memberId(spaceName: string, name: string): Promise<string> {
    const { items } = (await this.api.get(`/api/v1/spaces/${this.spaces.get(spaceName)!}/members`)) as {
      items: { id: string; displayName: string }[];
    };
    return items.find((m) => m.displayName === name)!.id;
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.people.values()].map((p) => p.dispose()));
  }
}
