/**
 * App-wide store: market metadata, selected symbol, environment telemetry,
 * and dark/light theme state.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { PairInfo, SpotMarketsResult, AssetInfo } from "@poly/core";
import { api, type EnvInfo } from "./api";

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
  envInfo: EnvInfo | null;
  marketsError: string | null;
  marketsLoading: boolean;
  marketsUpdatedAt: number | null;
  connectionStatus: ConnectionStatus;
  refreshMarkets: () => void;
  symbol: string;
  setSymbol: (s: string) => void;
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  toggleTheme: () => void;
}

const Ctx = createContext<AppState | null>(null);

const SYMBOL_KEY = "poly-tools:symbol";
const THEME_KEY = "poly-tools:theme";

function loadInitialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore storage error */
  }
  return "dark";
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [markets, setMarkets] = useState<SpotMarketsResult | null>(null);
  const [envInfo, setEnvInfo] = useState<EnvInfo | null>(null);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [marketsLoading, setMarketsLoading] = useState<boolean>(true);
  const [marketsUpdatedAt, setMarketsUpdatedAt] = useState<number | null>(null);
  const [symbol, setSymbolState] = useState<string>(() => {
    try {
      return localStorage.getItem(SYMBOL_KEY) ?? "BTC-USDT";
    } catch {
      return "BTC-USDT";
    }
  });
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

  const fetchMeta = useCallback(() => {
    let alive = true;
    setMarketsLoading(true);
    api
      .markets()
      .then((m) => {
        if (!alive) return;
        setMarkets(m);
        setMarketsError(null);
        setMarketsUpdatedAt(Date.now());
      })
      .catch((e) => {
        if (!alive) return;
        setMarketsError(e instanceof Error ? e.message : "Failed to load market metadata");
      })
      .finally(() => {
        if (alive) setMarketsLoading(false);
      });

    api.env().then((e) => {
      if (alive && e) setEnvInfo(e);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const cleanup = fetchMeta();
    return cleanup;
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

  const setTheme = useCallback((t: ThemeMode) => {
    setThemeState(t);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const connectionStatus: ConnectionStatus = useMemo(() => {
    if (marketsLoading && !markets && !marketsError) return "connecting";
    if (marketsError && !markets) return "degraded";
    return "connected";
  }, [marketsLoading, markets, marketsError]);

  const value: AppState = {
    markets,
    pairs,
    assets,
    pairBySymbol,
    assetByCode,
    symbols,
    apiEnv: markets?.apiEnv ?? "testnet",
    envInfo,
    marketsError,
    marketsLoading,
    marketsUpdatedAt,
    connectionStatus,
    refreshMarkets: fetchMeta,
    symbol,
    setSymbol,
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
