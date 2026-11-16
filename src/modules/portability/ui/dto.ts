import type { paths } from "@/shared/ui/api/schema";

type Json<T> = T extends { content: { "application/json": infer B } } ? B : never;

/** D28, design §3.2: an upload's dry run, as `POST …/imports` and `PATCH …/imports/{importId}` answer it. */
export type ImportPreviewDto = Json<paths["/api/v1/spaces/{spaceId}/imports"]["post"]["responses"][201]>;
export type ImportAccountDto = ImportPreviewDto["accounts"][number];
export type ImportCategoryDto = ImportPreviewDto["categories"][number];
export type AccountMappingDto = ImportAccountDto["mapping"];
export type CategoryMappingDto = ImportCategoryDto["mapping"];
/** What a confirm did: its counts and the rows the ledger refused. */
export type ImportResultDto = Json<
  paths["/api/v1/spaces/{spaceId}/imports/{importId}/confirm"]["post"]["responses"][200]
>;
export type ImportCountsDto = NonNullable<ImportResultDto["counts"]>;
/** The personal space's past imports, newest first. */
export type ImportHistoryDto = Json<paths["/api/v1/spaces/{spaceId}/imports"]["get"]["responses"][200]>;
export type ImportSummaryDto = ImportHistoryDto["items"][number];
/** The body of a draft's adjustment: each field left out keeps what the draft has. */
export type ImportChangesDto = NonNullable<
  paths["/api/v1/spaces/{spaceId}/imports/{importId}"]["patch"]["requestBody"]
>["content"]["application/json"];
