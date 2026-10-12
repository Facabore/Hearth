const VALID = /^[A-Za-z0-9._-]{1,128}$/;

/** Echoes a well-formed incoming X-Request-Id; anything else gets a fresh UUID. */
export const requestIdFrom = (request: Request): string => {
  const incoming = request.headers.get("x-request-id");
  return incoming && VALID.test(incoming) ? incoming : crypto.randomUUID();
};
