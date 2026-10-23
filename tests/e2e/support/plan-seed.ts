import { request as playwright, type APIRequestContext } from "@playwright/test";
import { SeedApi } from "./api";
import { BASE_URL } from "./base-url";
import { Person } from "./people";
import type { World } from "./world";

/** Seeds through /api/v1 with a test's headers; a non-2xx answer fails the step (as M6a's SeedApi does). */
export class SeedClient {
  constructor(
    private readonly request: APIRequestContext,
    private readonly headers: () => Record<string, string>,
  ) {}

  async send(
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<unknown> {
    const response = await this.request.fetch(path, {
      method,
      headers: { ...this.headers(), ...extra },
      data: body,
    });
    if (!response.ok())
      throw new Error(`${method} ${path} answered ${response.status()}: ${await response.text()}`);
    return response.status() === 204 ? undefined : response.json();
  }

  get = (path: string) => this.send("GET", path);
  post = (path: string, body: unknown, version?: number) =>
    this.send("POST", path, body, version === undefined ? {} : { "if-match": `"${version}"` });
  put = (path: string, body: unknown, version: number) =>
    this.send("PUT", path, body, { "if-match": `"${version}"` });
  record = (path: string, body: unknown) =>
    this.send("POST", path, body, { "idempotency-key": crypto.randomUUID() });
}

export interface SeededHousehold {
  readonly spaceId: string;
  /** Member ids by display name. */
  readonly members: Readonly<Record<string, string>>;
  readonly juan: SeedClient;
  readonly juanSpaceId: string;
}

const households = new WeakMap<World, SeededHousehold>();

export const householdOf = (world: World): SeededHousehold => {
  const household = households.get(world);
  if (!household) throw new Error("No household was seeded in this scenario");
  return household;
};

export const clientOf = (world: World) => new SeedClient(world.page.request, () => world.headers());

/**
 * Ruling P222: the World's person (already signed up) creates the shared space and a link invitation; `member` signs
 * up in a request context of their own (their own cookie, the same test address) and accepts it. The member is kept
 * in the World's people, so the World disposes their request context at the end of the test.
 */
export const seedHousehold = async (
  world: World,
  { name, member, role }: { name: string; member: string; role: "ADMIN" | "MEMBER" | "VIEWER" },
): Promise<SeededHousehold> => {
  const ana = clientOf(world);
  const space = (await ana.post("/api/v1/spaces", { kind: "SHARED", name, currency: "COP" })) as {
    id: string;
  };
  const invite = (await ana.post(`/api/v1/spaces/${space.id}/invitations`, { kind: "LINK", role })) as {
    url: string;
  };
  const token = new URL(invite.url, BASE_URL).pathname.split("/").filter(Boolean).at(-1)!;
  const context = await playwright.newContext({ baseURL: BASE_URL, extraHTTPHeaders: world.headers() });
  const juan = new SeedClient(context, () => world.headers());
  const email = world.email(`${member.toLowerCase()}@example.com`);
  const { user } = (await juan.post("/api/v1/auth/sign-up", {
    name: member,
    email,
    password: "123456789012",
    timezone: "America/Bogota",
  })) as { user: { id: string } };
  await juan.post(`/api/v1/invitations/${token}/accept`, {});
  const { items: juanSpaces } = (await juan.get("/api/v1/spaces")) as {
    items: { id: string; kind: string }[];
  };
  const juanSpaceId = juanSpaces.find((s) => s.kind === "PERSONAL")!.id;
  world.people.set(
    member,
    new Person(member, email, user.id, juanSpaceId, new SeedApi(context, () => world.headers()), context),
  );
  world.spaces.set(name, space.id);
  const { items } = (await ana.get(`/api/v1/spaces/${space.id}/members`)) as {
    items: { id: string; displayName: string }[];
  };
  const household = {
    spaceId: space.id,
    members: Object.fromEntries(items.map((m) => [m.displayName, m.id])),
    juan,
    juanSpaceId,
  };
  households.set(world, household);
  return household;
};

/** The space's seeded categories by catalog key (rent, groceries, utilities, entertainment, restaurants, …). */
export const categoryIdsByKey = async (
  client: SeedClient,
  spaceId: string,
): Promise<Record<string, string>> => {
  const { items } = (await client.get(`/api/v1/spaces/${spaceId}/categories`)) as {
    items: { categories: { id: string; key: string | null }[] }[];
  };
  return Object.fromEntries(
    items.flatMap((g) => g.categories).flatMap((c) => (c.key ? [[c.key, c.id]] : [])),
  );
};

const cop = (pesos: number) => ({ amount: String(BigInt(pesos) * 100n), currency: "COP" });
type PlanAnswer = { id: string; version: number; lines: { id: string; name: string }[] };

/**
 * HU-E6's reference plan: Ana 1,600,000 COP and Juan 2,400,000 COP; Rent (SHARED_FUND), Home, Savings (into
 * `savingsAccountId`) and Free, all RESET; the E7 mappings; Free the catch-all only when asked; ACTIVE when asked.
 */
export const seedReferencePlan = async (
  ana: SeedClient,
  hh: SeededHousehold,
  options: { period: string; catchAll: boolean; activate: boolean; savingsAccountId: string },
): Promise<{ planId: string; version: number; lineIds: Record<string, string> }> => {
  const base = `/api/v1/spaces/${hh.spaceId}/plans`;
  let plan = (await ana.post(base, { period: options.period })) as PlanAnswer;
  plan = (await ana.put(
    `${base}/${plan.id}/capacities`,
    {
      capacities: [
        { memberId: hh.members["Ana"], amount: cop(1_600_000) },
        { memberId: hh.members["Juan"], amount: cop(2_400_000) },
      ],
    },
    plan.version,
  )) as PlanAnswer;
  const lines: [string, number, string, Record<string, unknown>][] = [
    ["Rent", 1_200_000, "SHARED_FUND", {}],
    ["Home", 1_470_000, "DIRECT", {}],
    ["Savings", 600_000, "SAVINGS", { savingsAccountIds: [options.savingsAccountId] }],
    ["Free", 730_000, "DIRECT", { isCatchAll: options.catchAll }],
  ];
  for (const [name, pesos, funding, extra] of lines)
    plan = (await ana.post(
      `${base}/${plan.id}/lines`,
      { name, plannedAmount: cop(pesos), funding, rolloverMode: "RESET", ...extra },
      plan.version,
    )) as PlanAnswer;
  const lineIds = Object.fromEntries(plan.lines.map((l) => [l.name, l.id]));
  const keys = await categoryIdsByKey(ana, hh.spaceId);
  const mappings = [
    ["Rent", ["rent"]],
    ["Home", ["groceries", "utilities"]],
    ["Free", ["entertainment"]],
  ] as const;
  for (const [line, categories] of mappings)
    plan = (await ana.put(
      `${base}/${plan.id}/lines/${lineIds[line]}/categories`,
      { categoryIds: categories.map((key) => keys[key]) },
      plan.version,
    )) as PlanAnswer;
  if (options.activate)
    plan = (await ana.post(`${base}/${plan.id}/activate`, {}, plan.version)) as PlanAnswer;
  return { planId: plan.id, version: plan.version, lineIds };
};
