declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    adminDatabaseUrl: string;
  }
}

export {};
