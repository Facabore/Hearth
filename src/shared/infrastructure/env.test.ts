import { describe, expect, it } from "vitest";
import { EnvError, loadEnv } from "./env";

const valid = {
  DATABASE_URL: "postgres://hearth:hearth@db:5432/hearth",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "https://hearth.example.com",
};

describe("loadEnv", () => {
  it("parses a valid environment with defaults", () => {
    expect(loadEnv(valid)).toEqual({ ...valid, APP_TIMEZONE: "America/Bogota", LOG_LEVEL: "info" });
  });

  it("names every missing or invalid variable, sorted", () => {
    expect(() => loadEnv({ ...valid, BETTER_AUTH_SECRET: undefined, DATABASE_URL: "mysql://nope" })).toThrow(
      new EnvError("Missing or invalid environment variables: BETTER_AUTH_SECRET, DATABASE_URL"),
    );
  });

  it("rejects a short secret, an unknown log level and an empty timezone", () => {
    expect(() => loadEnv({ ...valid, BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => loadEnv({ ...valid, LOG_LEVEL: "trace" })).toThrow(/LOG_LEVEL/);
    expect(() => loadEnv({ ...valid, APP_TIMEZONE: "" })).toThrow(/APP_TIMEZONE/);
  });

  it("accepts the postgresql scheme and never echoes secret values", () => {
    expect(loadEnv({ ...valid, DATABASE_URL: "postgresql://h@db/h" }).DATABASE_URL).toBe(
      "postgresql://h@db/h",
    );
    expect(() => loadEnv({ ...valid, BETTER_AUTH_SECRET: "leaky" })).not.toThrow(/leaky/);
  });
});
