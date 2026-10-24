/**
 * React data hooks — race-safe wrappers over @poly/core's startPoll.
 *
 * Guarantees:
 *  - Older in-flight requests from a previous dependency cycle never overwrite newer state.
 *  - Separates initial `loading` from background/manual `refreshing` to prevent UI layout shift.
 *  - Supports user-controlled pause/resume in addition to automatic hidden-tab pausing.
 *  - Reports request health to the global store when available.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { startPoll, type PollHandle } from "@poly/core";

export interface Polled<T> {
  data: T | null;
  error: string | null;
  /** True only when no data has been loaded yet for the current deps. */
  loading: boolean;
  /** True whenever a poll or manual refresh is currently in flight. */
  refreshing: boolean;
  updatedAt: number | null;
  lastErrorAt: number | null;
  paused: boolean;
  setPaused: (paused: boolean) => void;
  refresh: () => void;
}

export function usePollData<T>(
  fn: () => Promise<T>,
  intervalMs: number,
  deps: unknown[] = [],
): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [lastErrorAt, setLastErrorAt] = useState<number | null>(null);
  const [paused, setPaused] = useState<boolean>(false);

  const handleRef = useRef<PollHandle | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Monotonic generation counter to discard stale responses when deps change
  const genRef = useRef(0);
  // Monotonic request counter and manual-override flag serialized through startPoll.tick()
  const reqIdRef = useRef(0);
  const forceManualRef = useRef(false);

  useEffect(() => {
    const myGen = ++genRef.current;
    let mounted = true;
    setLoading(true);
    setError(null);

    const h = startPoll(
      async () => {
        const isForced = forceManualRef.current;
        forceManualRef.current = false;
        if (!mounted || myGen !== genRef.current || (pausedRef.current && !isForced)) return;
        const myReq = ++reqIdRef.current;
        setRefreshing(true);
        try {
          const result = await fnRef.current();
          if (!mounted || myGen !== genRef.current || myReq !== reqIdRef.current) return;
          setData(result);
          setError(null);
          setUpdatedAt(Date.now());
        } catch (e) {
          if (!mounted || myGen !== genRef.current || myReq !== reqIdRef.current) return;
          const msg = e instanceof Error ? e.message : "Request failed";
          setError(msg);
          setLastErrorAt(Date.now());
        } finally {
          if (mounted && myGen === genRef.current && myReq === reqIdRef.current) {
            setLoading(false);
            setRefreshing(false);
          }
        }
      },
      intervalMs,
      { runImmediately: true, pauseWhenHidden: true },
    );

    handleRef.current = h;
    return () => {
      mounted = false;
      h.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const refresh = useCallback(() => {
    forceManualRef.current = true;
    void handleRef.current?.tick();
  }, []);

  const setPausedWithResume = useCallback((next: boolean) => {
    pausedRef.current = next;
    setPaused(next);
    if (!next) {
      // React state updates are asynchronous. Update the ref first, then force
      // one immediate tick so Resume does not wait for the next interval.
      forceManualRef.current = true;
      void handleRef.current?.tick();
    }
  }, []);

  return {
    data,
    error,
    loading,
    refreshing,
    updatedAt,
    lastErrorAt,
    paused,
    setPaused: setPausedWithResume,
    refresh,
  };
}

/** Live clock for relative timestamps ("2s ago") and UTC countdowns. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
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
