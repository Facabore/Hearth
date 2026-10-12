import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: process.env.DRIZZLE_SCHEMA ?? "./src/**/*.schema.ts",
  out: process.env.DRIZZLE_OUT ?? "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://hearth:hearth@localhost:5432/hearth" },
});
