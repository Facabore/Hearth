import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/**/*.schema.ts",
  out: process.env.DRIZZLE_OUT ?? "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://hearth:hearth@localhost:5432/hearth" },
});
