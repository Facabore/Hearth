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

const RANK = { debug: 0, info: 1, warn: 2, error: 3 } as const;
export type LogLevel = keyof typeof RANK;

/** HU-E8-02: the JSON logger writing only events at `level` (LOG_LEVEL) or above; errors are always written. */
export const leveledLogger = (level: LogLevel): Logger => ({
  info: (event, data) => {
    if (RANK[level] <= RANK.info) write("info", event, data);
  },
  error: (event, data) => write("error", event, data),
});
