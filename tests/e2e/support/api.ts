import type { APIRequestContext } from "@playwright/test";

/** Seeds a scenario through /api/v1 with the test's headers; a non-2xx answer fails the step that seeds. */
export class SeedApi {
  constructor(
    private readonly request: APIRequestContext,
    private readonly headers: () => Record<string, string>,
  ) {}

  private async send(
    method: "GET" | "POST" | "PATCH" | "PUT",
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const response = await this.request.fetch(path, { method, headers: this.headers(), data: body });
    if (!response.ok())
      throw new Error(`${method} ${path} answered ${response.status()}: ${await response.text()}`);
    return response.status() === 204 ? undefined : response.json();
  }

  post = (path: string, body: unknown) => this.send("POST", path, body);
  patch = (path: string, body: unknown) => this.send("PATCH", path, body);
  put = (path: string, body: unknown) => this.send("PUT", path, body);
  get = (path: string) => this.send("GET", path);
}
