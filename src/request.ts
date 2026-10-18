export const REQUEST_TIMEOUT = 15000;
// Abort the fetch and bound UI waiting even if Auth or a transport ignores abort.
// An aborted request may already have committed: never infer rollback from this.
export async function boundedRequest<T>(
  request: (signal: AbortSignal) => PromiseLike<T>,
  external?: AbortSignal,
  timeout = REQUEST_TIMEOUT,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: () => void = () => {};
  const deadline = new Promise<never>((_, reject) => {
    cancel = () => {
      controller.abort();
      reject(new Error("request_cancelled"));
    };
    if (external?.aborted) cancel();
    else external?.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("request_timeout"));
    }, timeout);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => request(controller.signal)),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", cancel);
  }
}
