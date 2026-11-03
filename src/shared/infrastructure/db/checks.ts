import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * A CHECK body that keeps a text column to a closed vocabulary (#249). The values are written as literals, so
 * `db:check` sees a new migration as soon as the list it is given changes. A null passes, as in every CHECK.
 */
export const oneOf = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} IN (${sql.raw(values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", "))})`;
