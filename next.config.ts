import type { NextConfig } from "next";

// Next.js serves only the API (`/api/v1`); the screens are the single-page app (ADR 0006).
export default {
  output: "standalone",
  poweredByHeader: false,
} satisfies NextConfig;
