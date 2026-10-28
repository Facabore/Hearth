/** Set by the proxy on every page request: the path and query a sign-in redirect returns to. */
export const PATH_HEADER = "x-hearth-path";

/**
 * Set by the proxy on every page request (#196): "1" for the browser's document request, "0" for a client navigation
 * or a prefetch (they carry `RSC`). The proxy always overwrites it, so a browser cannot claim either.
 */
export const DOCUMENT_HEADER = "x-hearth-document";
