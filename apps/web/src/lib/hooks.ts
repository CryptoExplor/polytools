/**
 * React data hooks — thin wrappers over the core poller so every page
 * gets: loading/data/error state, jittered interval polling, auto-pause
 * on hidden tab, and a manual refresh().
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { startPoll, type PollHandle } from "@poly/core";

export interface Polled<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  updatedAt: number | null;
  refresh: () => void;
}

export function usePollData<T>(
  fn: () => Promise<T>,
  intervalMs: number,
  deps: unknown[] = [],
): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const handleRef = useRef<PollHandle | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    setLoading(true);
    setError(null);
    const h = startPoll(async () => {
      try {
        const result = await fnRef.current();
        setData(result);
        setError(null);
        setUpdatedAt(Date.now());
      } catch (e) {
        setError(e instanceof Error ? e.message : "request failed");
      } finally {
        setLoading(false);
      }
    }, intervalMs);
    handleRef.current = h;
    return () => h.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const refresh = useCallback(() => {
    setLoading(true);
    void handleRef.current?.tick().finally(() => setLoading(false));
  }, []);

  return { data, error, loading, updatedAt, refresh };
}

/** Live clock for "updated Xs ago" labels. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Ring buffer of recent numbers (used for live sparklines). */
export function useRingBuffer(capacity: number) {
  const ref = useRef<number[]>([]);
  return useCallback(
    (v: number | null): number[] => {
      if (v !== null && isFinite(v)) {
        const buf = ref.current;
        if (buf[buf.length - 1] !== v) {
          buf.push(v);
          if (buf.length > capacity) buf.shift();
        }
      }
      return ref.current;
    },
    [capacity],
  );
}
