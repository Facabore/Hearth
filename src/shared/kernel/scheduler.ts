/** HU-E4-12: runs a job again and again; the adapter decides how (an in-container timer in v1, ruling P20). */
export interface Scheduler {
  /** Runs `job` now, then `intervalMs` after each run ends; the returned function stops it. */
  every(intervalMs: number, job: () => Promise<void>): () => void;
}
