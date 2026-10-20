import type { components, paths } from "./schema";

type Json<T> = T extends { content: { "application/json": infer B } } ? B : never;

export type MeDto = Json<paths["/api/v1/me"]["get"]["responses"][200]>;
export type SpaceListDto = Json<paths["/api/v1/spaces"]["get"]["responses"][200]>;
export type SpaceDto = components["schemas"]["Space"];
export type AccountListDto = Json<paths["/api/v1/spaces/{spaceId}/accounts"]["get"]["responses"][200]>;
export type AccountDto = components["schemas"]["Account"];
export type TransactionPageDto = Json<
  paths["/api/v1/spaces/{spaceId}/transactions"]["get"]["responses"][200]
>;
export type TransactionDto = TransactionPageDto["items"][number];
export type CategoryGroupDto = components["schemas"]["CategoryGroup"];
export type CategoryDto = components["schemas"]["Category"];
export type PeriodDto = Json<
  paths["/api/v1/spaces/{spaceId}/periods"]["get"]["responses"][200]
>["items"][number];
export type MoneyDto = components["schemas"]["Money"];
export type ProblemDto = components["schemas"]["Problem"];
