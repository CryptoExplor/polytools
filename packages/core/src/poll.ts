/**
 * Polling helper with jitter, single-flight, and visibility-aware pause.
 * Used by both the backend cache warmers and the React data hooks.
 */

export interface PollHandle {
  stop: () => void;
  tick: () => Promise<void>;
}

export function startPoll(
  fn: () => Promise<unknown>,
  intervalMs: number,
  opts: {
    jitterRatio?: number;
    runImmediately?: boolean;
    /** Pause when document is hidden (browser only). */
    pauseWhenHidden?: boolean;
  } = {},
): PollHandle {
  const { jitterRatio = 0.15, runImmediately = true, pauseWhenHidden = true } = opts;
  let stopped = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function tick() {
    if (stopped || inFlight) return;
    if (pauseWhenHidden && typeof document !== "undefined" && document.hidden) return;
    inFlight = true;
    try {
      await fn();
    } catch {
      /* swallow: caller keeps its own error state */
    } finally {
      inFlight = false;
    }
  }

  function schedule() {
    if (stopped) return;
    const jitter = intervalMs * jitterRatio * (Math.random() * 2 - 1);
    timer = setTimeout(async () => {
      await tick();
      schedule();
    }, Math.max(250, intervalMs + jitter));
  }

  if (runImmediately) void tick();
  schedule();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    tick,
  };
}
