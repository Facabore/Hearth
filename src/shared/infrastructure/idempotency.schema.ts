import { integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    userId: text("user_id").notNull(),
    route: text("route").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    responseHeaders: jsonb("response_headers").$type<[string, string][]>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.route, t.key] })],
);
