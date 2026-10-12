import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { pathToFileURL } from "node:url";

/** Applies every pending migration in `migrationsFolder` to the database at `url`. */
export async function runMigrations(url, migrationsFolder = "drizzle") {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Missing or invalid environment variables: DATABASE_URL");
    process.exit(1);
  }
  await runMigrations(url, process.env.MIGRATIONS_FOLDER ?? "drizzle");
  console.log("Migrations applied.");
}
