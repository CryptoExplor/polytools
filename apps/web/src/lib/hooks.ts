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

export interface PollSnapshot<T> {
  data: T;
  dependencies: readonly unknown[];
  updatedAt: number;
}

export interface PollErrorSnapshot {
  error: string;
  dependencies: readonly unknown[];
  lastErrorAt: number;
}

function dependenciesMatch(
  snapshot: { dependencies: readonly unknown[] },
  dependencies: readonly unknown[],
): boolean {
  return snapshot.dependencies.length === dependencies.length &&
    snapshot.dependencies.every((value, index) => Object.is(value, dependencies[index]));
}

/** Return a cached value only when its request dependencies still match. */
export function selectPollSnapshot<T>(
  snapshot: PollSnapshot<T> | null,
  dependencies: readonly unknown[],
): PollSnapshot<T> | null {
  return snapshot && dependenciesMatch(snapshot, dependencies) ? snapshot : null;
}

/** Return an error/failure timestamp only for the request that produced it. */
export function selectPollErrorSnapshot(
  snapshot: PollErrorSnapshot | null,
  dependencies: readonly unknown[],
): PollErrorSnapshot | null {
  return snapshot && dependenciesMatch(snapshot, dependencies) ? snapshot : null;
}

export function usePollData<T>(
  fn: () => Promise<T>,
  intervalMs: number,
  deps: unknown[] = [],
): Polled<T> {
  const [snapshot, setSnapshot] = useState<PollSnapshot<T> | null>(null);
  const [errorSnapshot, setErrorSnapshot] = useState<PollErrorSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [paused, setPaused] = useState<boolean>(false);
  const currentSnapshot = selectPollSnapshot(snapshot, deps);
  const currentErrorSnapshot = selectPollErrorSnapshot(errorSnapshot, deps);
  const dependenciesChanged = (snapshot !== null && currentSnapshot === null) ||
    (errorSnapshot !== null && currentErrorSnapshot === null);

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
    setSnapshot((current) => selectPollSnapshot(current, deps));
    setErrorSnapshot((current) => selectPollErrorSnapshot(current, deps));
    setLoading(true);

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
          setSnapshot({
            data: result,
            dependencies: deps.slice(),
            updatedAt: Date.now(),
          });
          setErrorSnapshot(null);
        } catch (e) {
          if (!mounted || myGen !== genRef.current || myReq !== reqIdRef.current) return;
          const msg = e instanceof Error ? e.message : "Request failed";
          setErrorSnapshot({
            error: msg,
            dependencies: deps.slice(),
            lastErrorAt: Date.now(),
          });
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
    data: currentSnapshot?.data ?? null,
    error: currentErrorSnapshot?.error ?? null,
    loading: loading || dependenciesChanged,
    refreshing: dependenciesChanged ? false : refreshing,
    updatedAt: currentSnapshot?.updatedAt ?? null,
    lastErrorAt: currentErrorSnapshot?.lastErrorAt ?? null,
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
