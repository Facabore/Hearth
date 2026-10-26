/**
 * HU-E8-02: whether `probe` succeeds within `ms`. A failure, or a probe still pending when the time is up, reads as
 * unreachable, so a hung database answers the health check in bounded time instead of queueing behind it.
 */
export const reachableWithin = async (ms: number, probe: () => Promise<unknown>): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeUp = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([
      probe().then(
        () => true,
        () => false,
      ),
      timeUp,
    ]);
  } finally {
    clearTimeout(timer);
  }
};
