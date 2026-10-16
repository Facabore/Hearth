import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument, changedOperations } from "./openapi";

const SNAPSHOT = "openapi/openapi.snapshot.json";

describe("OpenAPI document", () => {
  const doc = buildOpenApiDocument() as {
    openapi: string;
    paths: Record<string, Record<string, unknown>>;
    components: { schemas: Record<string, unknown> };
  };

  it("is OpenAPI 3.1.0 with the foundation operations and shared schemas", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths["/api/v1/health"]?.get).toBeDefined();
    expect(doc.paths["/api/v1/openapi.json"]?.get).toBeDefined();
    expect(doc.paths["/api/v1/me"]?.get).toBeDefined();
    expect(doc.components.schemas.Money).toBeDefined();
    expect(doc.components.schemas.Problem).toBeDefined();
  });

  it("matches the committed snapshot operation by operation", () => {
    if (process.env.UPDATE_OPENAPI_SNAPSHOT === "1") {
      writeFileSync(SNAPSHOT, `${JSON.stringify(doc, null, 2)}\n`);
      return;
    }
    const committed = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
    expect(changedOperations(committed, doc)).toEqual([]);
    expect(doc.components).toEqual(committed.components);
  });

  it("registers the recurrence components of M3-C, and no Output variant of them", () => {
    const names = Object.keys(doc.components.schemas);
    expect(names).toEqual(expect.arrayContaining(["RecurrenceDefinition", "Recurrence"]));
    expect(names.filter((name) => /^(Recurrence|Occurrence|RecurrenceDefinition)Output$/.test(name))).toEqual(
      [],
    );
  });

  it("describes a recurrence as a response whose pause reason, next date, end date, split and last occurrence may be null", () => {
    type Property = { type?: string | string[]; enum?: string[]; anyOf?: Property[]; oneOf?: Property[] };
    const recurrence = doc.components.schemas.Recurrence as {
      required: string[];
      properties: Record<string, Property>;
    };
    const nullable = (name: string) => {
      const property = recurrence.properties[name];
      const variants = [property, ...(property?.anyOf ?? []), ...(property?.oneOf ?? [])];
      return variants.some((variant) => variant?.type === "null" || variant?.type?.includes("null"));
    };

    expect(recurrence.required).toEqual(
      expect.arrayContaining([
        "id",
        "type",
        "description",
        "amount",
        "mode",
        "schedule",
        "startDate",
        "endDate",
        "status",
        "pauseReason",
        "nextOccurrence",
        "categoryId",
        "payerMemberId",
        "sourceAccountId",
        "destinationAccountId",
        "split",
        "lastOccurrence",
        "createdBy",
        "createdAt",
      ]),
    );
    expect(recurrence.properties.status?.enum).toEqual(["ACTIVE", "PAUSED", "ENDED"]);
    expect(recurrence.properties.mode?.enum).toEqual(["AUTO", "CONFIRM"]);
    for (const name of ["pauseReason", "nextOccurrence", "endDate", "split", "lastOccurrence"]) {
      expect(nullable(name), `${name} is nullable`).toBe(true);
    }
    for (const name of [
      "id",
      "description",
      "amount",
      "mode",
      "schedule",
      "startDate",
      "status",
      "createdAt",
    ]) {
      expect(nullable(name), `${name} is not nullable`).toBe(false);
    }
  });

  it("names the operations that were added, removed or changed", () => {
    const before = {
      paths: { "/api/v1/me": { get: { summary: "a" } }, "/x": { post: {} }, "/gone": { delete: {} } },
    };
    const after = {
      paths: { "/api/v1/me": { get: { summary: "b" } }, "/x": { post: {} }, "/y": { get: {} } },
    };
    expect(changedOperations(before, after)).toEqual(["DELETE /gone", "GET /api/v1/me", "GET /y"]);
  });

  it("reports nothing for identical documents", () => {
    expect(changedOperations(doc, structuredClone(doc))).toEqual([]);
  });
});
