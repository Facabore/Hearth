import type { APIRequest, APIRequestContext } from "@playwright/test";
import { SeedApi } from "./api";

const BASE_URL = "http://127.0.0.1:3100";

/** Ruling P178: someone else in a scenario, with their own session in their own request context. */
export class Person {
  constructor(
    readonly name: string,
    readonly email: string,
    readonly userId: string,
    readonly personalSpaceId: string,
    readonly api: SeedApi,
    private readonly context: APIRequestContext,
  ) {}

  static async signUp(
    requests: APIRequest,
    name: string,
    email: string,
    headers: Record<string, string>,
  ): Promise<Person> {
    const context = await requests.newContext({ baseURL: BASE_URL, extraHTTPHeaders: headers });
    const api = new SeedApi(context, () => headers);
    const { user } = (await api.post("/api/v1/auth/sign-up", {
      name,
      email,
      password: "123456789012",
      timezone: "America/Bogota",
    })) as { user: { id: string } };
    const { items } = (await api.get("/api/v1/spaces")) as { items: { id: string; kind: string }[] };
    return new Person(name, email, user.id, items.find((s) => s.kind === "PERSONAL")!.id, api, context);
  }

  dispose(): Promise<void> {
    return this.context.dispose();
  }
}
