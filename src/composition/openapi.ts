import { createDocument, type ZodOpenApiObject } from "zod-openapi";
import { mePaths } from "@/modules/identity/contracts/me.contract";
import { MoneySchema, ProblemSchema } from "@/shared/http/contracts";
import { healthPaths, openApiPaths } from "@/shared/http/system.contract";

export const buildOpenApiDocument = (): Record<string, unknown> =>
  createDocument({
    // zod-openapi 6 types target OAS 3.2; we emit 3.1.0 by design (ADR 0002).
    openapi: "3.1.0" as ZodOpenApiObject["openapi"],
    info: { title: "Hearth API", version: "1.0.0" },
    paths: { ...healthPaths, ...openApiPaths, ...mePaths },
    components: {
      schemas: { Money: MoneySchema, Problem: ProblemSchema },
      securitySchemes: {
        cookieAuth: { type: "apiKey", in: "cookie", name: "hearth.session_token" },
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    },
  }) as unknown as Record<string, unknown>;

type Paths = Record<string, Record<string, unknown>>;

/** Lists "METHOD /path" for every operation added, removed or changed between two documents. */
export const changedOperations = (before: { paths?: Paths }, after: { paths?: Paths }): string[] => {
  const operations = (doc: { paths?: Paths }) =>
    Object.entries(doc.paths ?? {}).flatMap(([path, ops]) =>
      Object.keys(ops).map((method) => ({ method, path })),
    );
  const seen = new Map<string, { method: string; path: string }>();
  for (const op of [...operations(before), ...operations(after)]) seen.set(`${op.method} ${op.path}`, op);
  return [...seen.values()]
    .filter(
      ({ method, path }) =>
        JSON.stringify(before.paths?.[path]?.[method]) !== JSON.stringify(after.paths?.[path]?.[method]),
    )
    .map(({ method, path }) => `${method.toUpperCase()} ${path}`)
    .sort();
};
