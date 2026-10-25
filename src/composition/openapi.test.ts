import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument, changedOperations, snapshotOf } from "./openapi";

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
      writeFileSync(SNAPSHOT, snapshotOf(doc));
      return;
    }
    const committed = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
    expect(changedOperations(committed, doc)).toEqual([]);
    expect(doc.components).toEqual(committed.components);
  });

  it("registers the recurrence components of M3-C, and no Output variant of them", () => {
    const names = Object.keys(doc.components.schemas);
    expect(names).toEqual(expect.arrayContaining(["RecurrenceDefinition", "Recurrence", "Occurrence"]));
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

  it("documents pausing, resuming and ending a recurrence as POSTs with no body that answer the recurrence", () => {
    type Operation = {
      requestBody?: unknown;
      responses: Record<string, { content: Record<string, { schema: { $ref: string } }> }>;
    };
    const documented = ["pause", "resume", "end"].map((name) => {
      const path = doc.paths[`/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}/${name}`] as
        Record<string, Operation> | undefined;
      const post = path?.post;
      return {
        methods: Object.keys(path ?? {}),
        body: post?.requestBody,
        statuses: Object.keys(post?.responses ?? {}),
        answer: post?.responses["200"]?.content["application/json"]?.schema.$ref,
      };
    });
    const answer = "#/components/schemas/Recurrence";
    expect(documented).toEqual([
      { methods: ["post"], body: undefined, statuses: ["200", "401", "403", "404", "409"], answer },
      // Resuming checks the template again, as recording would: its 404, 409 and 422 are that check's.
      { methods: ["post"], body: undefined, statuses: ["200", "401", "403", "404", "409", "422"], answer },
      { methods: ["post"], body: undefined, statuses: ["200", "401", "403", "404", "409"], answer },
    ]);
  });

  it("documents extending an ended recurrence as a POST whose body requires a nullable endDate and that answers the recurrence (#115)", () => {
    type Schema = { required?: string[]; properties?: Record<string, { anyOf?: { type: string }[] }> };
    type Operation = {
      requestBody?: { content: Record<string, { schema: Schema }> };
      responses: Record<string, { content?: Record<string, { schema: { $ref: string } }> }>;
    };
    const path = doc.paths["/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}/extend"] as
      Record<string, Operation> | undefined;
    const post = path?.post;
    const body = post?.requestBody?.content["application/json"]?.schema;
    expect([
      Object.keys(path ?? {}),
      Object.keys(post?.responses ?? {}),
      post?.responses["200"]?.content?.["application/json"]?.schema.$ref,
      body?.required,
      body?.properties?.endDate?.anyOf?.map((variant) => variant.type),
    ]).toEqual([
      ["post"],
      ["200", "401", "403", "404", "409", "422"],
      "#/components/schemas/Recurrence",
      ["endDate"],
      ["string", "null"],
    ]);
  });

  it("says a recurrence edit refuses a payer or split participant who left or never was a member, and a resume one who left", () => {
    type Operation = { responses: Record<string, { description: string }> };
    const path = (suffix: string) =>
      doc.paths[`/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}${suffix}`] as unknown as Record<
        string,
        Operation
      >;
    const refusal = (operation: Operation | undefined) =>
      operation?.responses["422"]?.description.match(/NotASpaceMember \(([^)]*)\)/)?.[1];
    expect(refusal(path("").patch)).toBe(
      `a payer or a split participant is not a member, whether they left or never were; with member "creator", the recurrence's creator left`,
    );
    expect(refusal(path("/resume").post)).toBe(
      `a payer or a split participant left; with member "creator", the recurrence's creator left`,
    );
  });

  it("gives every category node an icon and a palette color, and every group its key, with no new Output variant (HU-E3-05)", () => {
    const schemas = doc.components.schemas as Record<
      string,
      { properties?: Record<string, { enum?: unknown[] }> }
    >;
    for (const name of ["Category", "CategoryOutput", "CategoryGroup", "CategoryGroupSummary"]) {
      expect(Object.keys(schemas[name]?.properties ?? {})).toEqual(expect.arrayContaining(["icon", "color"]));
    }
    expect(schemas.CategoryGroupSummary?.properties?.color?.enum).toHaveLength(16);
    // A group answers its catalog key, as a category does.
    for (const name of ["CategoryGroup", "CategoryGroupSummary"]) {
      expect(Object.keys(schemas[name]?.properties ?? {})).toContain("key");
    }
    expect(
      Object.keys(schemas)
        .filter((name) => name.endsWith("Output"))
        .sort(),
    ).toEqual(["CategoryOutput", "MoneyOutput"]);
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

  it("writes the snapshot with its component schemas in name order, so a component never moves (#114)", () => {
    const written = JSON.parse(
      snapshotOf({ openapi: "3.1.0", paths: {}, components: { schemas: { Zeta: {}, Alpha: {}, Mid: {} } } }),
    );
    expect(Object.keys(written.components.schemas)).toEqual(["Alpha", "Mid", "Zeta"]);
    expect(Object.keys(JSON.parse(snapshotOf(doc)).components.schemas)).toEqual(
      Object.keys(doc.components.schemas).sort(),
    );
  });

  it("is committed in that order", () => {
    const committed = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
    const names = Object.keys(committed.components.schemas);
    expect(names).toEqual([...names].sort());
  });
});
