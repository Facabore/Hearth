/** Deep copy that turns bigints into strings so values can be stored as JSON or sent over HTTP. */
export const toJsonSafe = (value: unknown): unknown =>
  value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));
