import { inject } from "vitest";
import { createDatabase } from "@/shared/infrastructure/db/client";

export const testDatabase = () => createDatabase(inject("databaseUrl"));
