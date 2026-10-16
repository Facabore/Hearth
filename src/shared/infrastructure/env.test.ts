import { describe, expect, it } from "vitest";
import { EnvError, loadEnv } from "./env";

const valid = {
  DATABASE_URL: "postgres://hearth:hearth@db:5432/hearth",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "https://hearth.example.com",
};

describe("loadEnv", () => {
  it("parses a valid environment with defaults", () => {
    expect(loadEnv(valid)).toEqual({
      ...valid,
      APP_TIMEZONE: "America/Bogota",
      LOG_LEVEL: "info",
      RECURRENCE_JOB_INTERVAL_SECONDS: 300,
    });
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

  it("reads the recurring-transactions interval in seconds, 0 turning the job off (HU-E4-12)", () => {
    expect(loadEnv({ ...valid, RECURRENCE_JOB_INTERVAL_SECONDS: "0" }).RECURRENCE_JOB_INTERVAL_SECONDS).toBe(
      0,
    );
    expect(loadEnv({ ...valid, RECURRENCE_JOB_INTERVAL_SECONDS: "60" }).RECURRENCE_JOB_INTERVAL_SECONDS).toBe(
      60,
    );
    expect(() => loadEnv({ ...valid, RECURRENCE_JOB_INTERVAL_SECONDS: "-1" })).toThrow(
      /RECURRENCE_JOB_INTERVAL_SECONDS/,
    );
    expect(() => loadEnv({ ...valid, RECURRENCE_JOB_INTERVAL_SECONDS: "1.5" })).toThrow(
      /RECURRENCE_JOB_INTERVAL_SECONDS/,
    );
    expect(() => loadEnv({ ...valid, RECURRENCE_JOB_INTERVAL_SECONDS: "86401" })).toThrow(
      /RECURRENCE_JOB_INTERVAL_SECONDS/,
    );
  });

  it("refuses a blank or non-decimal interval instead of reading it as 0, which would turn the job off", () => {
    for (const blank of ["", " ", "1e3", "0x10", "abc"])
      expect(() => loadEnv({ ...valid, RECURRENCE_JOB_INTERVAL_SECONDS: blank })).toThrow(
        /RECURRENCE_JOB_INTERVAL_SECONDS/,
      );
  });
});
