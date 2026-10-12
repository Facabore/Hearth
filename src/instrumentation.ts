/** Next.js startup hook: refuse to serve with a missing or invalid environment (HU-E0-07). */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadEnv } = await import("@/shared/infrastructure/env");
  try {
    loadEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
