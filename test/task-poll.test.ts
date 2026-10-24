import { afterEach, describe, expect, it, vi } from "vitest";
import { taskPollTicks } from "../src/task-poll.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("taskPollTicks", () => {
  it("yields immediately so the first poll does not wait", async () => {
    const started = Date.now();
    let yielded = false;
    for await (const _ of taskPollTicks(1000, 10_000)) {
      yielded = true;
      break;
    }
    expect(yielded).toBe(true);
    expect(Date.now() - started).toBeLessThan(50);
  });

  it("keeps ticking without a maximum wait", async () => {
    vi.useFakeTimers();
    let ticks = 0;
    const consume = (async () => {
      for await (const _ of taskPollTicks(undefined, 10_000)) {
        ticks += 1;
        if (ticks === 3) break;
      }
    })();

    await vi.advanceTimersByTimeAsync(20_000);
    await consume;

    expect(ticks).toBe(3);
  });
});
