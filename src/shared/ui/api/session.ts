/** Better Auth names its cookie with the `hearth` prefix, and with `__Secure-` over HTTPS. */
export const SESSION_COOKIES = ["hearth.session_token", "__Secure-hearth.session_token"] as const;

/** Whether the request carries a session cookie at all; only the API says whether it is still valid. */
export const hasSession = (cookies: { has(name: string): boolean }): boolean =>
  SESSION_COOKIES.some((name) => cookies.has(name));
