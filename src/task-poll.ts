export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

/** Yield immediately, then wait `intervalMs` between later ticks; without `maxWaitMs`, keep ticking. */
export async function* taskPollTicks(maxWaitMs: number | undefined, intervalMs: number): AsyncGenerator<void> {
  const startedAt = Date.now();
  while (maxWaitMs === undefined || Date.now() - startedAt <= maxWaitMs) {
    yield;
    if (maxWaitMs !== undefined && Date.now() - startedAt > maxWaitMs) return;
    await sleep(intervalMs);
  }
}
