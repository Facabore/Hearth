import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { Pool } from "pg";

export type Database = NodePgDatabase;
/** The database or an open transaction; repositories write through this. */
export type Executor = PgDatabase<NodePgQueryResultHKT>;

export const createDatabase = (url: string): { db: Database; pool: Pool } => {
  const pool = new Pool({ connectionString: url, max: 10 });
  return { db: drizzle({ client: pool }), pool };
};
