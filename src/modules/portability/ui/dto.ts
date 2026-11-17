import type { paths } from "@/shared/ui/api/schema";

type Json<T> = T extends { content: { "application/json": infer B } } ? B : never;

/** D28, design §3.2: an upload's dry run, as `POST …/imports` and `PATCH …/imports/{importId}` answer it. */
export type ImportPreviewDto = Json<paths["/api/v1/spaces/{spaceId}/imports"]["post"]["responses"][201]>;
export type ImportAccountDto = ImportPreviewDto["accounts"][number];
/** P337: a top-level Money Manager category as the group it becomes, and its categories. */
export type ImportCategoryGroupDto = ImportPreviewDto["categories"]["groups"][number];
export type ImportCategoryDto = ImportCategoryGroupDto["categories"][number];
export type AccountMappingDto = ImportAccountDto["mapping"];
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
/** A mapping as the person sends it: a new record's name is optional, the file's (or a free variant) by default. */
export type AccountMappingInputDto = NonNullable<ImportChangesDto["accounts"]>[string];
