export interface Logger {
  info(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
}

const write = (level: string, event: string, data: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level, event, time: new Date().toISOString(), ...data }));

/** One JSON object per line on stdout, for `docker logs` and log shippers. */
export const jsonLogger: Logger = {
  info: (event, data) => write("info", event, data),
  error: (event, data) => write("error", event, data),
};
