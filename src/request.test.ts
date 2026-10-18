import { afterEach, expect, it, vi } from "vitest";
import { boundedRequest } from "./request";
afterEach(() => vi.useRealTimers());
it("bounds an unresponsive transport and aborts without claiming server rollback", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const work = boundedRequest(
    (s) => {
      signal = s;
      return new Promise(() => {});
    },
    undefined,
    100,
  );
  const failure = expect(work).rejects.toThrow("request_timeout");
  await vi.advanceTimersByTimeAsync(100);
  await failure;
  expect(signal?.aborted).toBe(true);
});
it("cancels on account reset and handles a transport that ignores cancellation", async () => {
  const controller = new AbortController();
  const work = boundedRequest(() => new Promise(() => {}), controller.signal);
  controller.abort();
  await expect(work).rejects.toThrow("request_cancelled");
});
it("returns confirmation and clears the deadline", async () => {
  vi.useFakeTimers();
  await expect(boundedRequest(async () => "confirmed")).resolves.toBe(
    "confirmed",
  );
  expect(vi.getTimerCount()).toBe(0);
});
