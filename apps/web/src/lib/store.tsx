/**
 * App-wide store: market metadata, selected symbol, environment telemetry,
 * local watchlist, and dark/light theme state.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PairInfo, SpotMarketsResult, AssetInfo } from "@poly/core";
import {
  api,
  hasUsedWireSamples,
  subscribeWireSampleUsage,
  type EnvInfo,
} from "./api";
import {
  decodePublicSpotMarkets,
  MARKET_METADATA_CACHE_KEY,
  MARKET_METADATA_POLICY,
  MARKET_METADATA_REVALIDATE_MS,
  MARKET_METADATA_SCHEMA,
  marketMetadataCache,
  type PublicSpotMarkets,
} from "./marketMetadataCache";
import { publicCacheLoadDecision, type PublicCacheHit } from "./publicCache";
import {
  MetadataRequestSequencer,
  shouldApplyMetadataNetworkResult,
} from "./metadataRequestSequencer";

export type ThemeMode = "dark" | "light";
export type ConnectionStatus = "connecting" | "connected" | "degraded";

interface AppState {
  markets: SpotMarketsResult | null;
  pairs: PairInfo[];
  assets: AssetInfo[];
  pairBySymbol: Map<string, PairInfo>;
  assetByCode: Map<string, AssetInfo>;
  symbols: string[];
  apiEnv: string;
  dataSource: "live" | "wire-samples";
  /** Sticky for this app session once any public fallback response is observed. */
  wireSampleUsed: boolean;
  envInfo: EnvInfo | null;
  marketsError: string | null;
  marketsLoading: boolean;
  marketsUpdatedAt: number | null;
  marketsRefreshing: boolean;
  marketsCacheStatus: {
    origin: "memory" | "persistent";
    savedAt: number;
    freshUntil: number;
  } | null;
  connectionStatus: ConnectionStatus;
  refreshMarkets: () => void;
  symbol: string;
  setSymbol: (s: string) => void;
  watchlist: string[];
  toggleWatchlist: (s: string) => void;
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  toggleTheme: () => void;
}

const Ctx = createContext<AppState | null>(null);

const SYMBOL_KEY = "poly-tools:symbol";
const THEME_KEY = "poly-tools:theme";
const WATCH_KEY = "poly-tools:watch:v1";

function loadInitialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore storage error */
  }
  return "dark";
}

function loadInitialWatchlist(): string[] {
  try {
    const raw = localStorage.getItem(WATCH_KEY);
    if (!raw) return ["BTC-USDT", "ETH-USDT", "SOL-USDT"];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return ["BTC-USDT", "ETH-USDT", "SOL-USDT"];
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [markets, setMarkets] = useState<SpotMarketsResult | null>(null);
  const [envInfo, setEnvInfo] = useState<EnvInfo | null>(null);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [marketsLoading, setMarketsLoading] = useState<boolean>(true);
  const [marketsUpdatedAt, setMarketsUpdatedAt] = useState<number | null>(null);
  const [marketsRefreshing, setMarketsRefreshing] = useState<boolean>(false);
  const [marketsCacheStatus, setMarketsCacheStatus] = useState<AppState["marketsCacheStatus"]>(null);
  const [wireSampleUsed, setWireSampleUsed] = useState(hasUsedWireSamples);
  const [symbol, setSymbolState] = useState<string>(() => {
    try {
      return localStorage.getItem(SYMBOL_KEY) ?? "BTC-USDT";
    } catch {
      return "BTC-USDT";
    }
  });
  const [watchlist, setWatchlist] = useState<string[]>(loadInitialWatchlist);
  const [theme, setThemeState] = useState<ThemeMode>(loadInitialTheme);

  // Sync theme to document root
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute("content", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => subscribeWireSampleUsage(() => setWireSampleUsed(true)), []);

  const requestSequencer = useRef(new MetadataRequestSequencer());
  const marketsUpdatedAtRef = useRef<number | null>(null);

  const fetchMeta = useCallback((options: { force?: boolean; includeEnv?: boolean } = {}) => {
    const sequencer = requestSequencer.current;
    const cacheRequest = sequencer.beginCacheCheck();
    const force = options.force === true;
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    const isCurrent = () => sequencer.isCacheCheckCurrent(cacheRequest);
    let networkRequest: number | null = null;
    const isNetworkCurrent = () => networkRequest !== null &&
      sequencer.isNetworkRefreshCurrent(networkRequest);

    if (options.includeEnv && !offline) {
      const environmentRequest = sequencer.beginEnvironmentRefresh();
      void api.env().then((environment) => {
        if (sequencer.isEnvironmentRefreshCurrent(environmentRequest) && environment) {
          setEnvInfo(environment);
        }
      });
    }

    void (async () => {
      try {
        let hit: PublicCacheHit<PublicSpotMarkets> | null = null;
        try {
          hit = await marketMetadataCache.read(
            MARKET_METADATA_CACHE_KEY,
            MARKET_METADATA_POLICY,
            decodePublicSpotMarkets,
          );
        } catch {
          // Cache failure is fail-open: the validated network path remains available.
        }
        if (!isCurrent()) return;

        if (hit && marketsUpdatedAtRef.current !== hit.entry.savedAt) {
          marketsUpdatedAtRef.current = hit.entry.savedAt;
          setMarkets(hit.entry.value);
          setMarketsUpdatedAt(hit.entry.savedAt);
          setMarketsCacheStatus({
            origin: hit.origin,
            savedAt: hit.entry.savedAt,
            freshUntil: hit.entry.freshUntil,
          });
        }
        if (hit) {
          setMarketsError(null);
          setMarketsLoading(false);
        }

        const decision = publicCacheLoadDecision({
          offline,
          fresh: hit?.fresh ?? false,
          force,
        });
        if (decision === "use-fresh") return;
        if (decision === "offline") {
          setMarketsError(
            hit
              ? "Offline; showing the last valid cached public market metadata."
              : "Offline; public market metadata is unavailable.",
          );
          return;
        }

        if (marketsUpdatedAtRef.current === null) setMarketsLoading(true);
        setMarketsRefreshing(true);
        // Only actual network refreshes supersede one another. A later fresh
        // cache/offline check returns above without invalidating this request.
        networkRequest = sequencer.beginNetworkRefresh();
        const result = await marketMetadataCache.refresh({
          key: MARKET_METADATA_CACHE_KEY,
          policy: MARKET_METADATA_POLICY,
          decode: decodePublicSpotMarkets,
          fetcher: () => api.marketsForCache(),
        });
        if (!shouldApplyMetadataNetworkResult({
          requestCurrent: isNetworkCurrent(),
          resultSavedAt: result.savedAt,
          visibleSavedAt: marketsUpdatedAtRef.current,
        })) return;
        marketsUpdatedAtRef.current = result.savedAt;
        setMarkets(result.value);
        setMarketsUpdatedAt(result.savedAt);
        setMarketsCacheStatus(null);
        setMarketsError(null);
      } catch (error) {
        // A later cache-only success may supersede an error, but not a successful
        // network value. Another network request owns its own error/loading state.
        const ownsError = networkRequest === null
          ? isCurrent()
          : isCurrent() && isNetworkCurrent();
        if (!ownsError) return;
        setMarketsError(error instanceof Error ? error.message : "Failed to load market metadata");
      } finally {
        const ownsLoadingState = networkRequest === null ? isCurrent() : isNetworkCurrent();
        if (ownsLoadingState) {
          setMarketsLoading(false);
          setMarketsRefreshing(false);
        }
      }
    })();
  }, []);

  useEffect(() => {
    void marketMetadataCache.cleanup([MARKET_METADATA_SCHEMA]).catch(() => undefined);
    fetchMeta({ includeEnv: true });
    return () => requestSequencer.current.invalidate();
  }, [fetchMeta]);

  useEffect(() => {
    const check = () => {
      if (document.visibilityState === "visible") fetchMeta();
    };
    const timer = window.setInterval(() => {
      // Offline intervals do no work; the online/visible events trigger revalidation.
      if (navigator.onLine) check();
    }, MARKET_METADATA_REVALIDATE_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    window.addEventListener("offline", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check);
      window.removeEventListener("offline", check);
    };
  }, [fetchMeta]);

  const refreshMarkets = useCallback(() => {
    fetchMeta({ force: true, includeEnv: true });
  }, [fetchMeta]);

  const pairs = useMemo(() => markets?.pairs ?? [], [markets]);
  const assets = useMemo(() => markets?.assets ?? [], [markets]);
  const symbols = useMemo(() => pairs.map((p) => p.symbol), [pairs]);
  const pairBySymbol = useMemo(
    () => new Map(pairs.map((p) => [p.symbol, p])),
    [pairs],
  );
  const assetByCode = useMemo(
    () => new Map(assets.map((a) => [a.asset, a])),
    [assets],
  );

  // If stored symbol isn't in listed pairs once loaded, fall back to BTC-USDT or first pair.
  useEffect(() => {
    if (symbols.length && !symbols.includes(symbol)) {
      setSymbolState(symbols.includes("BTC-USDT") ? "BTC-USDT" : symbols[0]);
    }
  }, [symbols, symbol]);

  const setSymbol = useCallback((s: string) => {
    setSymbolState(s);
    try {
      localStorage.setItem(SYMBOL_KEY, s);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleWatchlist = useCallback((s: string) => {
    setWatchlist((prev) => {
      const next = prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s];
      try {
        localStorage.setItem(WATCH_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const setTheme = useCallback((t: ThemeMode) => {
    setThemeState(t);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const connectionStatus: ConnectionStatus = useMemo(() => {
    if (marketsLoading && !markets && !marketsError) return "connecting";
    if (marketsError) return "degraded";
    return "connected";
  }, [marketsLoading, markets, marketsError]);

  const dataSource: "live" | "wire-samples" = useMemo(() => {
    const src = (markets as unknown as Record<string, unknown> | null)?.dataSource;
    return src === "wire-samples" ? "wire-samples" : "live";
  }, [markets]);

  useEffect(() => {
    // Persistent cached samples also count as sample use after a reload.
    if (dataSource === "wire-samples") setWireSampleUsed(true);
  }, [dataSource]);

  const value: AppState = {
    markets,
    pairs,
    assets,
    pairBySymbol,
    assetByCode,
    symbols,
    apiEnv: markets?.apiEnv ?? "testnet",
    dataSource,
    wireSampleUsed,
    envInfo,
    marketsError,
    marketsLoading,
    marketsUpdatedAt,
    marketsRefreshing,
    marketsCacheStatus,
    connectionStatus,
    refreshMarkets,
    symbol,
    setSymbol,
    watchlist,
    toggleWatchlist,
    theme,
    setTheme,
    toggleTheme,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside provider");
  return v;
}
